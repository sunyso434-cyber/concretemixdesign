// ignore_for_file: file_names
// 文件名 WorkspacePage 为任务简报指定的 PascalCase 命名，保持原样。

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/ConnectionService.dart';
import '../services/RemoteClient.dart';

/// 工作区选择页：最近工作区列表 + 切换 + 当前标识 + 监听广播。
///
/// 协议对齐电脑端 R8（RemoteWorkspaceApi）：
/// - 列表：`workspace:listRecent` → 同通道响应 `{ requestId, success, recent[] }`，
///   每项 `{ path, savedAt, isCurrent }`（path 展示）
/// - 当前标识：`workspace:current` → `{ requestId, success, path }`，列表高亮当前项
/// - 切换：点击 → `workspace:open { path }` → 成功后重新拉取列表/当前；
///   服务端同时广播 `workspace:changed` 触发双向同步
/// - 监听：收到 `workspace:changed { path }` 推送 → 立即高亮 + 重新拉取
///
/// 响应约定：同通道回 `{ type, requestId, success, ... }`，线上为 FanoutSink
/// wrapWs 的 `{ channel, payload }` 包装（与 SessionsPage 一致）。
class WorkspacePage extends StatefulWidget {
  const WorkspacePage({
    super.key,
    this.client,
    this.connectionService,
  });

  /// 注入的 WebSocket 客户端（测试注入 fake；生产为 null 时自动创建连接）。
  final RemoteClient? client;

  /// 连接配置服务（生产读取 token；测试可注入）。
  final ConnectionService? connectionService;

  @override
  State<WorkspacePage> createState() => _WorkspacePageState();
}

class _WorkspacePageState extends State<WorkspacePage> {
  RemoteClient? _client;
  StreamSubscription<Map<String, dynamic>>? _sub;
  List<Map<String, dynamic>> _recent = const [];
  String? _currentPath; // 当前工作区 path（workspace:current 响应 / workspace:changed 推送）
  bool _loading = true;
  String? _error; // 列表加载失败
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
      if (injected.isConnected) _loadAll();
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
          _fatalError = '未配对或未登录，请先扫码配对再选择工作区';
        });
      }
      return;
    }
    try {
      await _client!.connect(addr, token);
    } catch (_) {
      // 网络失败由 RemoteClient 后台按指数退避重连，等 auth_ok 后拉数据。
    }
  }

  // ---------- 事件分发 ----------

  void _onEvent(Map<String, dynamic> raw) {
    final type = raw['type'];
    if (type == 'auth_ok') {
      _loadAll(); // 认证成功（含重连）→ 拉列表 + 当前
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
      case 'workspace:listRecent':
        _onListRecent(data);
        break;
      case 'workspace:current':
        _onCurrent(data);
        break;
      case 'workspace:open':
        _onOpen(data);
        break;
      case 'workspace:changed':
        _onChanged(data);
        break;
    }
  }

  // ---------- 列表 / 当前 ----------

  /// 拉取最近工作区列表 + 当前工作区。
  void _loadAll() {
    try {
      _client?.send('workspace:listRecent', {});
      _client?.send('workspace:current', {});
    } catch (_) {
      // 未连接时忽略，等 auth_ok 再拉。
    }
  }

  void _onListRecent(Map<String, dynamic> data) {
    if (data['success'] != true) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = (data['error'] ?? '加载工作区失败').toString();
      });
      return;
    }
    final list = data['recent'];
    if (list is! List) return;
    if (!mounted) return;
    setState(() {
      _loading = false;
      _error = null;
      _recent = list
          .whereType<Map<String, dynamic>>()
          .where((e) => e['path'] is String && (e['path'] as String).isNotEmpty)
          .toList();
    });
  }

  void _onCurrent(Map<String, dynamic> data) {
    if (data['success'] != true || !mounted) return;
    setState(() {
      _currentPath = data['path'] as String?;
    });
  }

  // ---------- 切换 / 广播 ----------

  /// 点击工作区 → workspace:open。成功后服务端广播 workspace:changed
  /// 触发双向同步；此处同时等待 open 响应成功兜底刷新。
  void _openWorkspace(String path) {
    try {
      _client?.send('workspace:open', {'path': path});
    } catch (_) {
      // 未连接时忽略。
    }
  }

  void _onOpen(Map<String, dynamic> data) {
    if (data['success'] != true) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('切换失败：${data['error'] ?? '未知错误'}')),
      );
      return;
    }
    // 成功：重新拉取列表与当前（广播 workspace:changed 也会触发，幂等无害）。
    _loadAll();
  }

  /// 服务端广播 workspace:changed（桌面端切换了工作区）：
  /// 立即高亮新 path + 重新拉取列表/当前，保持双向同步。
  void _onChanged(Map<String, dynamic> data) {
    final path = data['path'];
    if (!mounted) return;
    setState(() {
      _currentPath = path is String ? path : null;
    });
    _loadAll();
  }

  // ---------- 工具 ----------

  /// 该工作区是否为当前工作区：listRecent 标注 isCurrent 或 path 等于当前 path。
  bool _isCurrent(Map<String, dynamic> item) {
    final path = item['path'];
    if (path is! String) return false;
    return item['isCurrent'] == true || path == _currentPath;
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
        title: const Text('选择工作区'),
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
    if (_recent.isEmpty) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.folder_open, size: 48, color: Colors.grey),
            SizedBox(height: 12),
            Text('暂无工作区'),
          ],
        ),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.symmetric(vertical: 4),
      itemCount: _recent.length,
      itemBuilder: (context, index) {
        final item = _recent[index];
        final path = item['path'] as String;
        final current = _isCurrent(item);
        return ListTile(
          leading: const Icon(Icons.folder_outlined),
          title: Text(path, maxLines: 1, overflow: TextOverflow.ellipsis),
          trailing: current
              ? const Text(
                  '当前',
                  style: TextStyle(
                    color: Colors.green,
                    fontWeight: FontWeight.bold,
                  ),
                )
              : null,
          onTap: () => _openWorkspace(path),
        );
      },
    );
  }
}
