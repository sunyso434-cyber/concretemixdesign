// ignore_for_file: file_names
// 文件名 ChatPage 为任务简报指定的 PascalCase 命名，保持原样。

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/ConnectionService.dart';
import '../services/RemoteClient.dart';
import '../widgets/ConfirmationDialog.dart';
import '../widgets/MessageBubble.dart';
import '../widgets/TodoPanel.dart';

/// 一条对话消息。
class _ChatMessage {
  _ChatMessage({
    required this.role,
    required this.text,
    this.streaming = false,
    this.error,
  });

  /// 'user' | 'assistant'
  final String role;

  String text;
  bool streaming;
  String? error;
}

/// Agent 对话页（手机端核心 UI，协议对齐电脑端 R5/R6）。
///
/// - 发送：`agent:run { sessionId, message }`，同通道响应处理 `agent:run`
/// - 流式：`agent:progress` 的 `text_delta`（增量追加）/ `done` / `error`
/// - 确认：收到 `agent:confirmation-request` 弹窗，回答后发 `agent:confirm`
/// - Todo：收 `todo:updated` 更新面板；断线重连后拉 `todo:list` 重同步
/// - 断线：轮询 [RemoteClient.isConnected] + 监听 `auth_ok` 显示连接状态
class ChatPage extends StatefulWidget {
  const ChatPage({
    super.key,
    required this.sessionId,
    this.client,
    this.connectionService,
  });

  /// 会话 ID（本地生成时间戳；`agent:run` 首条会自动建会话）。
  final String sessionId;

  /// 注入的 WebSocket 客户端（测试注入 fake；生产为 null 时自动创建连接）。
  final RemoteClient? client;

  /// 连接配置服务（生产读取 token；测试可注入）。
  final ConnectionService? connectionService;

  @override
  State<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends State<ChatPage> {
  RemoteClient? _client;
  StreamSubscription<Map<String, dynamic>>? _sub;
  final List<_ChatMessage> _messages = [];
  List<Map<String, dynamic>> _todos = const [];
  ConfirmationRequest? _pendingConfirmation;
  final TextEditingController _inputCtrl = TextEditingController();
  final ScrollController _scrollCtrl = ScrollController();
  Timer? _pollTimer;
  bool _connected = false;
  bool _sending = false;
  String? _fatalError; // 未配对/未登录等致命提示

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    final injected = widget.client;
    if (injected != null) {
      // 注入分支（测试）：直接用注入客户端，跳过配对/登录。
      _client = injected;
      _sub = injected.events.listen(_onEvent);
      _connected = injected.isConnected;
      if (_connected) _syncTodos();
      _startPoll();
      return;
    }

    _client = RemoteClient();
    _sub = _client!.events.listen(_onEvent);
    _startPoll();

    // 生产分支：从本地读取配对地址 + token，建立连接。
    final prefs = await SharedPreferences.getInstance();
    final addr = prefs.getString(ConnectionService.addrKey);
    final token =
        await (widget.connectionService ?? ConnectionService()).getToken();
    if (addr == null || addr.isEmpty || token == null || token.isEmpty) {
      if (mounted) {
        setState(() => _fatalError = '未配对或未登录，请先扫码配对再进入对话');
      }
      return;
    }
    try {
      await _client!.connect(addr, token);
    } catch (_) {
      // 网络失败由 RemoteClient 后台按指数退避重连，UI 显示「连接中」，等 auth_ok 恢复。
    }
    if (mounted) {
      setState(() => _connected = _client!.isConnected);
    }
  }

  /// 轮询连接状态：断线重连成功后（false→true）重同步 todo。
  void _startPoll() {
    _pollTimer = Timer.periodic(const Duration(seconds: 2), (_) {
      final client = _client;
      if (client == null) return;
      final nowConnected = client.isConnected;
      if (nowConnected != _connected) {
        setState(() => _connected = nowConnected);
        if (nowConnected) _syncTodos();
      }
    });
  }

  // ---------- 事件分发 ----------

  void _onEvent(Map<String, dynamic> raw) {
    final type = raw['type'];
    if (type == 'auth_ok') {
      if (mounted) setState(() => _connected = true);
      _syncTodos(); // 认证成功（含重连）→ 拉 todo 重同步
      return;
    }
    if (type == 'auth_error' ||
        type == 'auth_failed' ||
        type == 'auth_rejected') {
      if (mounted) setState(() => _connected = false);
      return;
    }

    // 业务消息统一为 { channel, payload }（电脑端 FanoutSink wrapWs 格式）。
    final channel = raw['channel'];
    if (channel is! String) return;
    final payload = raw['payload'];
    final data =
        payload is Map<String, dynamic> ? payload : <String, dynamic>{};
    if (!_belongsToSession(data)) return;

    switch (channel) {
      case 'agent:progress':
        _onProgress(data);
        break;
      case 'agent:confirmation-request':
        _onConfirmation(data);
        break;
      case 'todo:updated':
        _onTodo(data);
        break;
      case 'agent:run':
        _onRunResponse(data);
        break;
      case 'agent:confirm':
        _onConfirmResponse(data);
        break;
      case 'todo:list':
        _onTodo(data);
        break;
    }
  }

  /// 只处理当前会话的事件，避免其他会话的推送污染本页。
  bool _belongsToSession(Map<String, dynamic> data) {
    final sid = data['sessionId'];
    if (sid is String && sid.isNotEmpty && sid != widget.sessionId) return false;
    return true;
  }

  // ---------- agent:progress 流式事件 ----------

  void _onProgress(Map<String, dynamic> p) {
    final subtype = p['type'];
    if (subtype == 'text_delta' || subtype == 'stream' || subtype == 'delta') {
      final chunk = p['content'] ?? p['text'];
      if (chunk is! String || chunk.isEmpty) return;
      if (!mounted) return;
      setState(() {
        final current = _messages.isEmpty ? null : _messages.last;
        if (current != null && current.role == 'assistant' && current.streaming) {
          current.text += chunk;
        } else {
          _messages
              .add(_ChatMessage(role: 'assistant', text: chunk, streaming: true));
        }
      });
      _scrollToBottom();
    } else if (subtype == 'done') {
      final result = p['result'];
      final reply = result is Map<String, dynamic> ? result['reply'] : null;
      if (!mounted) return;
      setState(() {
        final current = _messages.isEmpty ? null : _messages.last;
        if (current != null && current.role == 'assistant' && current.streaming) {
          if (current.text.isEmpty && reply is String && reply.isNotEmpty) {
            current.text = reply;
          }
          current.streaming = false;
        }
        _sending = false;
      });
      _scrollToBottom();
    } else if (subtype == 'error') {
      final err = p['error'];
      final msg = err is Map<String, dynamic>
          ? (err['title'] ?? err['message'] ?? err['error'] ?? 'AI 执行出错')
              .toString()
          : (err ?? 'AI 执行出错').toString();
      if (!mounted) return;
      setState(() {
        final current = _messages.isEmpty ? null : _messages.last;
        if (current != null && current.role == 'assistant' && current.streaming) {
          current.streaming = false;
          current.error = msg;
          if (current.text.isEmpty) current.text = 'AI 执行失败';
        } else {
          _messages.add(
            _ChatMessage(role: 'assistant', text: 'AI 执行失败', error: msg),
          );
        }
        _sending = false;
      });
      _scrollToBottom();
    }
    // reasoning_start / reasoning_done / tool_start / tool_done / model_info 等
    // 暂不展示，静默忽略（不打断流式文本）。
  }

  // ---------- agent:confirmation-request ----------

  void _onConfirmation(Map<String, dynamic> data) {
    if (_pendingConfirmation != null) return; // 防重复弹窗
    final req = ConfirmationRequest.fromJson(data);
    _pendingConfirmation = req;
    _showConfirmation(req);
  }

  Future<void> _showConfirmation(ConfirmationRequest req) async {
    final answer = await showConfirmationDialog(context, req);
    if (!mounted) return;
    setState(() => _pendingConfirmation = null);
    if (answer != null) {
      _sendConfirm(confirmed: true, args: {'answer': answer});
    } else {
      _sendConfirm(confirmed: false, args: const {});
    }
  }

  void _sendConfirm({
    required bool confirmed,
    required Map<String, dynamic> args,
  }) {
    try {
      _client?.send('agent:confirm', {
        'sessionId': widget.sessionId,
        'confirmed': confirmed,
        'args': args,
      });
    } catch (_) {
      // 未连接等场景静默忽略；断线时确认无法送达，UI 无副作用。
    }
  }

  // ---------- todo ----------

  void _onTodo(Map<String, dynamic> data) {
    final todos = data['todos'];
    if (todos is! List) return;
    setState(() {
      _todos = todos.whereType<Map<String, dynamic>>().toList();
    });
  }

  void _syncTodos() {
    try {
      _client?.send('todo:list', {'sessionId': widget.sessionId});
    } catch (_) {
      // 未连接时忽略，等重连后 auth_ok 再拉。
    }
  }

  // ---------- agent:run 同通道响应 ----------

  void _onRunResponse(Map<String, dynamic> data) {
    if (data['success'] == false) {
      final err = data['error'];
      final msg = err is Map<String, dynamic>
          ? (err['title'] ?? err['message'] ?? err['error'] ?? '任务执行失败')
              .toString()
          : (err ?? '任务执行失败').toString();
      if (!mounted) return;
      setState(() {
        final current = _messages.isEmpty ? null : _messages.last;
        if (current != null && current.role == 'assistant' && current.streaming) {
          current.streaming = false;
          current.error = msg;
        } else {
          _messages.add(
            _ChatMessage(role: 'assistant', text: 'AI 执行失败', error: msg),
          );
        }
        _sending = false;
      });
      _scrollToBottom();
      return;
    }

    // 成功：结束流式（内容一般已由 text_delta / done 事件带出，此处兜底）。
    if (!mounted) return;
    setState(() {
      final current = _messages.isEmpty ? null : _messages.last;
      if (current != null && current.role == 'assistant' && current.streaming) {
        final content = data['content'];
        if (current.text.isEmpty && content is String && content.isNotEmpty) {
          current.text = content;
        }
        current.streaming = false;
      }
      _sending = false;
    });
    _scrollToBottom();
  }

  void _onConfirmResponse(Map<String, dynamic> data) {
    if (data['success'] == false && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('确认提交失败')),
      );
    }
  }

  // ---------- 发送 ----------

  void _sendMessage() {
    final text = _inputCtrl.text.trim();
    if (text.isEmpty || _sending || _client == null) return;
    _inputCtrl.clear();
    setState(() {
      _messages.add(_ChatMessage(role: 'user', text: text));
      _messages.add(
        _ChatMessage(role: 'assistant', text: '', streaming: true),
      );
      _sending = true;
    });
    _scrollToBottom();
    try {
      _client!.send('agent:run', {
        'sessionId': widget.sessionId,
        'message': text,
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          final current = _messages.last;
          current.streaming = false;
          current.error = '发送失败：${e is StateError ? e.message : e}';
          _sending = false;
        });
      }
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollCtrl.hasClients) return;
      _scrollCtrl.animateTo(
        _scrollCtrl.position.maxScrollExtent,
        duration: const Duration(milliseconds: 150),
        curve: Curves.easeOut,
      );
    });
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _sub?.cancel();
    _inputCtrl.dispose();
    _scrollCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Agent 对话'),
            const SizedBox(height: 2),
            Row(
              children: [
                Icon(
                  _connected ? Icons.circle : Icons.circle_outlined,
                  size: 10,
                  color: _connected ? Colors.green : Colors.grey,
                ),
                const SizedBox(width: 4),
                Text(
                  _connected
                      ? '已连接'
                      : (_fatalError != null ? '未配对' : '连接中…'),
                  style: const TextStyle(fontSize: 12),
                ),
              ],
            ),
          ],
        ),
      ),
      body: _fatalError != null
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.link_off, size: 48, color: Colors.grey),
                    const SizedBox(height: 12),
                    Text(_fatalError!, textAlign: TextAlign.center),
                  ],
                ),
              ),
            )
          : Column(
              children: [
                if (_todos.isNotEmpty) TodoPanel(todos: _todos),
                Expanded(
                  child: ListView.builder(
                    controller: _scrollCtrl,
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    itemCount: _messages.length,
                    itemBuilder: (_, i) {
                      final m = _messages[i];
                      return MessageBubble(
                        role: m.role,
                        text: m.text,
                        streaming: m.streaming,
                        error: m.error,
                      );
                    },
                  ),
                ),
                _InputBar(
                  controller: _inputCtrl,
                  onSend: _sendMessage,
                  enabled: _client != null && _connected && !_sending,
                ),
              ],
            ),
    );
  }
}

/// 底部输入栏：文本输入 + 发送按钮。
class _InputBar extends StatelessWidget {
  const _InputBar({
    required this.controller,
    required this.onSend,
    required this.enabled,
  });

  final TextEditingController controller;
  final VoidCallback onSend;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(8, 6, 8, 6),
        child: Row(
          children: [
            Expanded(
              child: TextField(
                controller: controller,
                enabled: enabled,
                minLines: 1,
                maxLines: 4,
                textInputAction: TextInputAction.send,
                decoration: InputDecoration(
                  hintText: '输入消息…',
                  isDense: true,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 10,
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                  ),
                ),
                onSubmitted: (_) => onSend(),
              ),
            ),
            const SizedBox(width: 6),
            IconButton.filled(
              onPressed: enabled ? onSend : null,
              icon: const Icon(Icons.send),
              tooltip: '发送',
            ),
          ],
        ),
      ),
    );
  }
}
