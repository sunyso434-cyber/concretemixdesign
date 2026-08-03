// ignore_for_file: file_names
// 文件名 LoginPage 为任务简报指定的 PascalCase 命名，保持原样。

import 'package:flutter/material.dart';

import '../services/ConnectionService.dart';

/// 登录页：访问密码 + 记住密码开关 → [ConnectionService.login] → 进主页。
///
/// - deviceId：配对时服务端签发并已由 [ConnectionService.pair] 保存；
///   登录直接用该 deviceId，本地不再生成（格式必须与服务端 `dev_<hex>` 一致）。
/// - 记住密码：开启时密码入 secure storage，下次冷启动自动填充；默认关闭。
/// - [onRepair]：重新扫码配对入口，返回 App 层回配对页（设备未配对时恢复路径）。
class LoginPage extends StatefulWidget {
  const LoginPage({
    super.key,
    this.connectionService,
    this.onLoggedIn,
    this.onRepair,
  });

  /// 连接配置服务（生产为 null 时自动创建；测试可注入）。
  final ConnectionService? connectionService;

  /// 登录成功回调（App 层进入主页）。
  final VoidCallback? onLoggedIn;

  /// 重新扫码配对回调（App 层回到配对页）。
  final VoidCallback? onRepair;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final TextEditingController _passwordCtrl = TextEditingController();
  bool _remember = false;
  bool _loading = false;
  bool _obscure = true; // 密码默认隐藏，点击眼睛切换可见
  String? _error;

  ConnectionService get _svc => widget.connectionService ?? ConnectionService();

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    // 记住密码预填充：secure storage 中有密码则自动填入并开启开关。
    final saved = await _svc.getPassword();
    if (saved != null && saved.isNotEmpty && mounted) {
      setState(() {
        _passwordCtrl.text = saved;
        _remember = true;
      });
    }
  }

  /// 设备标识：配对时服务端签发并已由 [ConnectionService.pair] 保存。
  ///
  /// 本地不再生成（服务端格式 `dev_<hex>` 与本地拼的 `dev-<时间>-<hex>` 永不匹配，
  /// 会因未注册被拒）。无 deviceId（未配对/存储被清）时传空串，服务端回
  /// DEVICE_NOT_PAIRED，配合「重新扫码配对」按钮恢复。
  Future<String> _deviceId() async => await _svc.getDeviceId() ?? '';

  Future<void> _login() async {
    final pw = _passwordCtrl.text.trim();
    if (pw.isEmpty) {
      setState(() => _error = '请输入访问密码');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    final deviceId = await _deviceId();
    final result = await _svc.login(pw, deviceId, remember: _remember);
    if (!mounted) return;
    setState(() => _loading = false);
    if (result.ok) {
      widget.onLoggedIn?.call();
      return;
    }
    setState(() => _error = _loginErrorText(result));
  }

  /// 把服务端错误码转成用户能看懂的中文提示。
  String _loginErrorText(LoginResult r) {
    switch (r.error) {
      case 'NOT_PAIRED':
        return '未配对，请先扫码配对';
      case 'DEVICE_NOT_PAIRED':
        return '设备未配对，请重新扫码配对';
      case 'LOCKED':
        final ms = r.retryAfterMs;
        if (ms != null) return '登录失败次数过多，请 ${(ms / 60000).ceil()} 分钟后重试';
        return '账号已被锁定，请稍后再试';
      case 'NETWORK_ERROR':
        return '网络异常，请检查网络后重试';
      case 'BAD_RESPONSE':
        return '服务器响应异常，请稍后再试';
      default:
        final left = r.attemptsLeft;
        if (left != null) return '密码错误，剩余 $left 次机会';
        return '登录失败：${r.error ?? '未知错误'}';
    }
  }

  @override
  void dispose() {
    _passwordCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('登录砼智')),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Icon(Icons.settings_remote, size: 64, color: scheme.primary),
              const SizedBox(height: 8),
              Text(
                '远程连接登录',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 24),
              TextField(
                controller: _passwordCtrl,
                obscureText: _obscure,
                enabled: !_loading,
                decoration: InputDecoration(
                  labelText: '访问密码',
                  border: const OutlineInputBorder(),
                  prefixIcon: const Icon(Icons.lock_outline),
                  suffixIcon: IconButton(
                    icon: Icon(
                      _obscure ? Icons.visibility_off : Icons.visibility,
                    ),
                    onPressed: _loading
                        ? null
                        : () => setState(() => _obscure = !_obscure),
                    tooltip: _obscure ? '显示密码' : '隐藏密码',
                  ),
                ),
                onSubmitted: (_) => _login(),
              ),
              const SizedBox(height: 8),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('记住密码'),
                subtitle: Text(_remember ? '下次免输密码' : '下次需重新输入密码'),
                value: _remember,
                onChanged: (v) => setState(() => _remember = v),
              ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    _error!,
                    textAlign: TextAlign.center,
                    style: TextStyle(color: scheme.error),
                  ),
                ),
              const SizedBox(height: 16),
              FilledButton(
                key: const Key('login-button'),
                onPressed: _loading ? null : _login,
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                child: _loading
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('登录'),
              ),
              // 设备未配对/重新配对时的恢复入口（I1：登录不再死胡同）。
              TextButton(
                key: const Key('repair-button'),
                onPressed: widget.onRepair,
                child: const Text('重新扫码配对'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
