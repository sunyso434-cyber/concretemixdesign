// ignore_for_file: file_names
// 文件名 LoginPage 为任务简报指定的 PascalCase 命名，保持原样。

import 'dart:math';

import 'package:flutter/material.dart';

import '../services/ConnectionService.dart';

/// 登录页：访问密码 + 记住密码开关 → [ConnectionService.login] → 进主页。
///
/// - deviceId：配对时由服务端签发并本地保存；首次登录本地无 deviceId 时
///   生成一个稳定的设备标识并保存，后续复用（登录成功会写回 secure storage）。
/// - 记住密码：开启时密码入 secure storage，下次冷启动自动填充；默认关闭。
class LoginPage extends StatefulWidget {
  const LoginPage({
    super.key,
    this.connectionService,
    this.onLoggedIn,
  });

  /// 连接配置服务（生产为 null 时自动创建；测试可注入）。
  final ConnectionService? connectionService;

  /// 登录成功回调（App 层进入主页）。
  final VoidCallback? onLoggedIn;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final TextEditingController _passwordCtrl = TextEditingController();
  bool _remember = false;
  bool _loading = false;
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

  /// 设备标识：优先用配对/登录时保存的；没有则生成稳定标识并保存。
  Future<String> _deviceId() async {
    final existing = await _svc.getDeviceId();
    if (existing != null && existing.isNotEmpty) return existing;
    final rand = Random().nextInt(0xFFFFFF).toRadixString(16);
    final id = 'dev-${DateTime.now().millisecondsSinceEpoch}-$rand';
    await _svc.saveDeviceId(id);
    return id;
  }

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
                obscureText: true,
                enabled: !_loading,
                decoration: const InputDecoration(
                  labelText: '访问密码',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(Icons.lock_outline),
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
            ],
          ),
        ),
      ),
    );
  }
}
