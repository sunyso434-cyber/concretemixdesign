// ignore_for_file: file_names
// 文件名 app 为任务简报指定的 PascalCase 命名，保持原样。

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'pages/ChatPage.dart';
import 'pages/LoginPage.dart';
import 'pages/PairPage.dart';
import 'pages/SessionsPage.dart';
import 'pages/SettingsPage.dart';
import 'pages/WorkspacePage.dart';
import 'services/ConnectionService.dart';
import 'services/RemoteClient.dart';

enum _AppScreen { loading, pair, login, home }

/// 根导航：冷启动流程 + 底部导航 + 全局登录态（auth 被拒 → 回登录页）。
///
/// - 冷启动：无配对地址 → [PairPage]（扫码）→ 配对成功 → [LoginPage] →
///   登录成功 → 主页；有配对地址 + token → 直接主页；token 过期 → 回 [LoginPage]。
/// - 主页底部导航：会话 / 对话 / 工作区 / 设置（4 tab）。
/// - 全局共享同一 RemoteClient 单例，并透传给三页（F6 共享模式，导航层维护单例）。
/// - 全局监听 auth 失效（auth_rejected / auth_error / auth_failed /
///   `{type:'error', error:'AUTH_FAILED'}`）→ 关连接 + 回登录页 + 提示
///   「登录已过期」，根治 F7 评审 I1「token 失效无限转圈」。
class ConcreteApp extends StatefulWidget {
  const ConcreteApp({
    super.key,
    this.connectionService,
    this.client,
    this.scannerBuilder,
  });

  /// 连接配置服务（生产为 null 时自动创建；测试可注入）。
  final ConnectionService? connectionService;

  /// 共享 RemoteClient 单例（生产为 null 时由 App 层创建并持有；测试注入 fake）。
  final RemoteClient? client;

  /// 扫码区域构建器（测试注入 fake 替代真实摄像头）。
  final ScannerBuilder? scannerBuilder;

  @override
  State<ConcreteApp> createState() => _ConcreteAppState();
}

class _ConcreteAppState extends State<ConcreteApp> {
  final GlobalKey<ScaffoldMessengerState> _scaffoldMessengerKey =
      GlobalKey<ScaffoldMessengerState>();

  _AppScreen _state = _AppScreen.loading;
  RemoteClient? _client;
  StreamSubscription<Map<String, dynamic>>? _authSub;
  bool _authRejected = false;
  bool _ownsClient = false;

  ConnectionService get _svc => widget.connectionService ?? ConnectionService();

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  @override
  void dispose() {
    _authSub?.cancel();
    if (_ownsClient) {
      unawaited(_client?.close());
    }
    super.dispose();
  }

  // ---------- 冷启动 ----------

  Future<void> _bootstrap() async {
    _authRejected = false;
    final prefs = await SharedPreferences.getInstance();
    final addr = prefs.getString(ConnectionService.addrKey);
    if (addr == null || addr.isEmpty) {
      if (mounted) setState(() => _state = _AppScreen.pair);
      return;
    }
    final token = await _svc.getToken();
    if (token == null || token.isEmpty) {
      if (mounted) setState(() => _state = _AppScreen.login);
      return;
    }
    await _enterHome();
  }

  /// 进入主页：确保共享客户端已连接。
  ///
  /// - 认证被拒（token 失效）→ 回登录页；
  /// - 网络失败 → RemoteClient 后台指数退避自动重连，仍进主页（页面显示「连接中」）。
  Future<void> _enterHome() async {
    _authRejected = false;
    if (mounted) setState(() => _state = _AppScreen.loading);
    final client = _ensureClient();
    final prefs = await SharedPreferences.getInstance();
    final addr = prefs.getString(ConnectionService.addrKey);
    final token = await _svc.getToken();
    if (addr == null || addr.isEmpty || token == null || token.isEmpty) {
      if (mounted) setState(() => _state = _AppScreen.login);
      return;
    }
    try {
      await client.connect(addr, token);
    } on RemoteClientException catch (e) {
      if (e.authRejected) {
        _handleAuthRejected();
        return;
      }
      // 网络层失败（authRejected=false）：RemoteClient 后台按指数退避自动重连，
      // UI 显示「连接中」。记日志便于排查，不吞掉。
      debugPrint('ConcreteApp._enterHome: 连接失败（后台重连中）: ${e.message}');
    } catch (e, st) {
      // 非 RemoteClientException 的未知错误：记日志避免静默吞掉。
      debugPrint('ConcreteApp._enterHome: 未知连接错误: $e\n$st');
    }
    if (!mounted) return;
    if (_authRejected) return; // 事件监听已切到登录页，勿覆盖
    setState(() => _state = _AppScreen.home);
  }

  RemoteClient _ensureClient() {
    final existing = _client;
    if (existing != null) return existing;
    final client = widget.client ?? RemoteClient();
    _client = client;
    _ownsClient = widget.client == null;
    _authSub = client.events.listen(_onClientEvent);
    return client;
  }

  // ---------- 全局 auth 失效处理 ----------

  void _onClientEvent(Map<String, dynamic> raw) {
    final type = raw['type'];
    final isAuthReject =
        type == 'auth_rejected' ||
            type == 'auth_error' ||
            type == 'auth_failed' ||
            // 服务端实际拒绝帧格式（RemoteServer._rejectWs）：{type:'error', error:'AUTH_FAILED'}
            (type == 'error' && raw['error'] == 'AUTH_FAILED');
    if (isAuthReject) _handleAuthRejected();
  }

  void _handleAuthRejected() {
    if (_authRejected) return; // 幂等：connect 抛错与事件监听可能双触发
    _authRejected = true;
    // 服务端已拒 token：主动关连接，停止 RemoteClient 后台重连（F7 I1 根治点）。
    unawaited(_client?.close());
    if (!mounted) return;
    setState(() => _state = _AppScreen.login);
    _scaffoldMessengerKey.currentState?.showSnackBar(
      const SnackBar(content: Text('登录已过期，请重新登录')),
    );
  }

  // ---------- 页面回调 ----------

  void _onPaired() {
    if (mounted) setState(() => _state = _AppScreen.login);
  }

  void _onLoggedIn() {
    _enterHome();
  }

  void _onLogout() {
    _authRejected = false;
    unawaited(_client?.close());
    if (mounted) setState(() => _state = _AppScreen.pair);
  }

  /// 登录页「重新扫码配对」：回配对页（不主动清 token，配对成功后重新登录）。
  void _onRepair() {
    _authRejected = false;
    if (mounted) setState(() => _state = _AppScreen.pair);
  }

  // ---------- UI ----------

  Widget _buildScreen() {
    switch (_state) {
      case _AppScreen.loading:
        return const _SplashScreen();
      case _AppScreen.pair:
        return PairPage(
          connectionService: _svc,
          scannerBuilder: widget.scannerBuilder,
          onPaired: _onPaired,
        );
      case _AppScreen.login:
        return LoginPage(
          connectionService: _svc,
          onLoggedIn: _onLoggedIn,
          onRepair: _onRepair,
        );
      case _AppScreen.home:
        return _HomePage(
          client: _client!,
          connectionService: _svc,
          onLogout: _onLogout,
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '砼智',
      scaffoldMessengerKey: _scaffoldMessengerKey,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo),
      ),
      home: _buildScreen(),
    );
  }
}

/// 冷启动 / 连接中的加载页。
class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: CircularProgressIndicator()),
    );
  }
}

/// 主页：底部导航（会话/对话/工作区/设置），四页共享同一 RemoteClient。
class _HomePage extends StatefulWidget {
  const _HomePage({
    required this.client,
    this.connectionService,
    this.onLogout,
  });

  final RemoteClient client;
  final ConnectionService? connectionService;
  final VoidCallback? onLogout;

  @override
  State<_HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<_HomePage> {
  int _index = 0;

  /// 「对话」tab 的会话 ID（App 会话期间固定，首条 agent:run 才在服务端落库）。
  late final String _chatSessionId;

  @override
  void initState() {
    super.initState();
    _chatSessionId = 'sess-${DateTime.now().millisecondsSinceEpoch}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _index,
        children: [
          SessionsPage(
            client: widget.client,
            connectionService: widget.connectionService,
          ),
          ChatPage(
            sessionId: _chatSessionId,
            client: widget.client,
            connectionService: widget.connectionService,
          ),
          WorkspacePage(
            client: widget.client,
            connectionService: widget.connectionService,
          ),
          SettingsPage(
            connectionService: widget.connectionService,
            onLogout: widget.onLogout,
          ),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.forum_outlined),
            selectedIcon: Icon(Icons.forum),
            label: '会话',
          ),
          NavigationDestination(
            icon: Icon(Icons.chat_bubble_outline),
            selectedIcon: Icon(Icons.chat_bubble),
            label: '对话',
          ),
          NavigationDestination(
            icon: Icon(Icons.folder_outlined),
            selectedIcon: Icon(Icons.folder),
            label: '工作区',
          ),
          NavigationDestination(
            icon: Icon(Icons.settings_outlined),
            selectedIcon: Icon(Icons.settings),
            label: '设置',
          ),
        ],
      ),
    );
  }
}
