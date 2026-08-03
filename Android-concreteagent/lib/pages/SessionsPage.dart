// ignore_for_file: file_names
// 文件名 SessionsPage 为任务简报指定的 PascalCase 命名，保持原样。

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/ConnectionService.dart';
import '../services/RemoteClient.dart';
import 'ChatPage.dart';

/// 历史会话页：会话列表 + 续聊 + 新建/删除/归档。
///
/// 协议对齐电脑端 R7（RemoteSessionApi）：
/// - 列表：`agent:listSessions` → 同通道响应 `{ requestId, success, sessions[] }`
/// - 续聊：点会话进入 [ChatPage] 并传入 sessionId；ChatPage 内发
///   `agent:getSessionMessages` 预载历史
/// - 新建：本地生成 sessionId → 进入空 [ChatPage]（首条 `agent:run` 才在服务端落库，
///   与电脑端"首条消息才建会话"一致）
/// - 删除：`agent:deleteSession { sessionId }`
/// - 归档：`agent:archiveSession { sessionIds: [...], archived: true }`
/// - 刷新：收到 `agent:sessionUpdated`（新会话标题生成 / 归档广播）重新拉取列表
class SessionsPage extends StatefulWidget {
  const SessionsPage({
    super.key,
    this.client,
    this.connectionService,
    this.sessionIdFactory,
  });

  /// 注入的 WebSocket 客户端（测试注入 fake；生产为 null 时自动创建连接）。
  final RemoteClient? client;

  /// 连接配置服务（生产读取 token；测试可注入）。
  final ConnectionService? connectionService;

  /// 新建会话的 sessionId 生成器（测试注入固定值；生产为 null 时用时间戳）。
  final String Function()? sessionIdFactory;

  @override
  State<SessionsPage> createState() => _SessionsPageState();
}

class _SessionsPageState extends State<SessionsPage> {
  RemoteClient? _client;
  StreamSubscription<Map<String, dynamic>>? _sub;
  List<Map<String, dynamic>> _sessions = const [];
  bool _loading = true;
  String? _error; // 列表加载失败
  String? _fatalError; // 未配对/未登录等致命提示
  final Map<String, bool> _expandedGroups = {}; // 各工作区分组的展开状态

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
      if (injected.isConnected) _listSessions();
      return;
    }

    _client = RemoteClient();
    _sub = _client!.events.listen(_onEvent);

    // 生产分支：从本地读取配对地址 + token，建立连接。
    final prefs = await SharedPreferences.getInstance();
    final addr = prefs.getString(ConnectionService.addrKey);
    final token =
        await (widget.connectionService ?? ConnectionService()).getToken();
    if (addr == null || addr.isEmpty || token == null || token.isEmpty) {
      if (mounted) {
        setState(() {
          _loading = false;
          _fatalError = '未配对或未登录，请先扫码配对再查看会话';
        });
      }
      return;
    }
    try {
      await _client!.connect(addr, token);
    } catch (_) {
      // 网络失败由 RemoteClient 后台按指数退避重连，等 auth_ok 后拉列表。
    }
  }

  // ---------- 事件分发 ----------

  void _onEvent(Map<String, dynamic> raw) {
    final type = raw['type'];
    if (type == 'auth_ok') {
      _listSessions(); // 认证成功（含重连）→ 拉会话列表
      return;
    }
    if (type == 'auth_error' ||
        type == 'auth_failed' ||
        type == 'auth_rejected') {
      return;
    }

    // 业务消息统一为 { channel, payload }（电脑端 FanoutSink wrapWs 格式）。
    final channel = raw['channel'];
    if (channel is! String) return;
    final payload = raw['payload'];
    final data =
        payload is Map<String, dynamic> ? payload : <String, dynamic>{};

    switch (channel) {
      case 'agent:listSessions':
        _onListSessions(data);
        break;
      case 'agent:sessionUpdated':
        // 新会话标题生成 / 归档广播 → 刷新列表
        _listSessions();
        break;
      case 'agent:deleteSession':
      case 'agent:archiveSession':
        if (data['success'] == false) _listSessions(); // 失败 → 重新同步
        break;
    }
  }

  // ---------- 会话列表 ----------

  void _listSessions() {
    try {
      _client?.send('agent:listSessions', {});
    } catch (_) {
      // 未连接时忽略，等 auth_ok 再拉。
    }
  }

  void _onListSessions(Map<String, dynamic> data) {
    if (data['success'] != true) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = (data['error'] ?? '加载会话失败').toString();
      });
      return;
    }
    final list = data['sessions'];
    if (list is! List) return;
    if (!mounted) return;
    setState(() {
      _loading = false;
      _error = null;
      _sessions = list.whereType<Map<String, dynamic>>().toList();
    });
  }

  // ---------- 续聊 / 新建 ----------

  /// 传给 ChatPage 的共享客户端。
  ///
  /// 未配对（[isFatal]）时返回 null：让 ChatPage 自行建连并显示「未配对」，
  /// 避免把未连接的共享客户端注入导致 ChatPage 一直显示「连接中」。
  RemoteClient? get _chatClient => _fatalError != null ? null : _client;

  void _openSession(Map<String, dynamic> session) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ChatPage(
          sessionId: session['sessionId'] as String,
          client: _chatClient,
          connectionService: widget.connectionService,
          workspacePath: session['workspacePath'] as String?,
        ),
      ),
    );
  }

  void _onNewSession() {
    final sessionId = _newSessionId();
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ChatPage(
          sessionId: sessionId,
          client: _chatClient,
          connectionService: widget.connectionService,
        ),
      ),
    );
  }

  String _newSessionId() {
    final factory = widget.sessionIdFactory;
    if (factory != null) return factory();
    return 'sess-${DateTime.now().millisecondsSinceEpoch}';
  }

  // ---------- 删除 / 归档 ----------

  /// 长按会话弹出操作菜单（归档 / 删除）。
  Future<void> _showActions(Map<String, dynamic> session) async {
    final action = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.archive_outlined),
              title: const Text('归档'),
              onTap: () => Navigator.pop(ctx, 'archive'),
            ),
            ListTile(
              leading: const Icon(Icons.delete_outline),
              title: const Text('删除'),
              onTap: () => Navigator.pop(ctx, 'delete'),
            ),
          ],
        ),
      ),
    );
    if (!mounted) return;
    if (action == 'archive') {
      _archiveSession(session);
    } else if (action == 'delete') {
      await _confirmDelete(session);
    }
  }

  void _archiveSession(Map<String, dynamic> session) {
    // 归档成功由服务端广播 sessionUpdated 触发重新拉取；此处先乐观移除。
    setState(() {
      _sessions.removeWhere(
        (s) => s['sessionId'] == session['sessionId'],
      );
    });
    try {
      _client?.send('agent:archiveSession', {
        'sessionIds': [session['sessionId']],
        'archived': true,
      });
    } catch (_) {
      // 未连接时忽略；会话会保留在列表，下次刷新仍在。
    }
  }

  Future<void> _confirmDelete(Map<String, dynamic> session) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('删除会话'),
        content: const Text('确定删除该会话？此操作不可恢复。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('确定删除'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    // 删除成功由响应 success 确认；此处先乐观移除。
    setState(() {
      _sessions.removeWhere((s) => s['sessionId'] == session['sessionId']);
    });
    try {
      _client?.send('agent:deleteSession', {
        'sessionId': session['sessionId'],
      });
    } catch (_) {
      // 未连接时忽略；会话会保留在列表，下次刷新仍在。
    }
  }

  // ---------- 工具 ----------

  /// 把服务端返回的 ISO 时间转成 `MM-DD HH:mm`。
  String _formatTime(dynamic raw) {
    if (raw is! String) return '';
    final dt = DateTime.tryParse(raw);
    if (dt == null) return '';
    final local = dt.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(local.month)}-${two(local.day)} '
        '${two(local.hour)}:${two(local.minute)}';
  }

  String _sessionTitle(Map<String, dynamic> session) {
    final name = session['sessionName'];
    return name is String && name.isNotEmpty ? name : '新对话';
  }

  /// 工作区分组 key：workspacePath 为空时归到「未分组」。
  String _groupKey(Map<String, dynamic> session) {
    final path = session['workspacePath'];
    return path is String && path.isNotEmpty ? path : '__no_workspace__';
  }

  /// 工作区显示名：取路径最后一段作为简称；无路径时显示「未分组」。
  String _groupLabel(String groupKey) {
    if (groupKey == '__no_workspace__') return '未分组';
    final sep = groupKey.contains('/') ? '/' : r'\';
    final parts = groupKey.split(sep).where((p) => p.isNotEmpty).toList();
    return parts.isEmpty ? groupKey : parts.last;
  }

  /// 切换某个工作区分组的展开/折叠状态。
  void _toggleGroup(String groupKey) {
    setState(() {
      _expandedGroups[groupKey] = !(_expandedGroups[groupKey] ?? false);
    });
  }

  /// 按工作区分组，保持原列表顺序（lastActivity 降序）。
  Map<String, List<Map<String, dynamic>>> _groupByWorkspace() {
    final groups = <String, List<Map<String, dynamic>>>{};
    for (final s in _sessions) {
      final key = _groupKey(s);
      groups.putIfAbsent(key, () => []).add(s);
    }
    return groups;
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  // ---------- UI ----------

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('历史会话'),
        actions: [
          IconButton(
            onPressed: _onNewSession,
            icon: const Icon(Icons.add),
            tooltip: '新建会话',
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_fatalError != null) {
      return Center(
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
      );
    }
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, size: 48, color: Colors.grey),
              const SizedBox(height: 12),
              Text(_error!, textAlign: TextAlign.center),
            ],
          ),
        ),
      );
    }
    if (_sessions.isEmpty) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.forum_outlined, size: 48, color: Colors.grey),
            SizedBox(height: 12),
            Text('暂无会话'),
          ],
        ),
      );
    }
    return _buildGroupedList();
  }

  /// 按工作区分组渲染会话列表，每组超过 3 条折叠隐藏。
  Widget _buildGroupedList() {
    final groups = _groupByWorkspace();
    final widgets = <Widget>[];

    for (final entry in groups.entries) {
      final groupKey = entry.key;
      final sessions = entry.value;
      final expanded = _expandedGroups[groupKey] ?? false;
      final showCount = expanded ? sessions.length : (sessions.length > 3 ? 3 : sessions.length);

      // 分组标题
      widgets.add(
        Container(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          color: Theme.of(context).colorScheme.surfaceContainerHighest,
          child: Row(
            children: [
              Icon(
                Icons.folder_outlined,
                size: 16,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  _groupLabel(groupKey),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
              Text(
                '${sessions.length}',
                style: TextStyle(
                  fontSize: 12,
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      );

      // 会话条目
      for (var i = 0; i < showCount; i++) {
        final session = sessions[i];
        widgets.add(ListTile(
          title: Text(
            _sessionTitle(session),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          subtitle: Text(_formatTime(session['lastActivity'])),
          trailing: const Icon(Icons.more_vert, size: 20),
          onTap: () => _openSession(session),
          onLongPress: () => _showActions(session),
        ));
      }

      // 折叠/展开按钮
      if (sessions.length > 3) {
        widgets.add(
          InkWell(
            onTap: () => _toggleGroup(groupKey),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 16),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    expanded ? '收起' : '展开全部 ${sessions.length} 条',
                    style: TextStyle(
                      fontSize: 13,
                      color: Theme.of(context).colorScheme.primary,
                    ),
                  ),
                  const SizedBox(width: 4),
                  Icon(
                    expanded ? Icons.expand_less : Icons.expand_more,
                    size: 18,
                    color: Theme.of(context).colorScheme.primary,
                  ),
                ],
              ),
            ),
          ),
        );
      }
    }

    return ListView(
      padding: const EdgeInsets.symmetric(vertical: 4),
      children: widgets,
    );
  }
}
