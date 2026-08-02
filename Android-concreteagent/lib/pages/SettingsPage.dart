// ignore_for_file: file_names
// 文件名 SettingsPage 为任务简报指定的 PascalCase 命名，保持原样。

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/ConnectionService.dart';

/// 设置页：服务器地址（域名）、证书状态、记住密码开关、退出登录、关于。
///
/// - 退出登录：清除 token/密码/deviceId（secure storage）+ 配对地址
///   （shared_preferences）后回调 [onLogout]，App 层回到配对页。
/// - 记住密码开关：反映 secure storage 中是否已保存密码；关闭即删除已存密码。
class SettingsPage extends StatefulWidget {
  const SettingsPage({
    super.key,
    this.connectionService,
    this.onLogout,
  });

  /// 连接配置服务（生产为 null 时自动创建；测试可注入）。
  final ConnectionService? connectionService;

  /// 退出登录回调（App 层清态后回到配对页）。
  final VoidCallback? onLogout;

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  // task F8 约束：不改 ConnectionService。直接读写底层存储，键名必须与
  // ConnectionService 内部键对齐（auth.token / auth.password / auth.deviceId）。
  static const _tokenKey = 'auth.token';
  static const _passwordKey = 'auth.password';
  static const _deviceIdKey = 'auth.deviceId';

  final FlutterSecureStorage _secure = const FlutterSecureStorage();

  String? _domain;
  bool _remember = false;
  bool _loading = true;

  ConnectionService get _svc => widget.connectionService ?? ConnectionService();

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    final prefs = await SharedPreferences.getInstance();
    final addr = prefs.getString(ConnectionService.addrKey);
    final password = await _svc.getPassword();
    if (!mounted) return;
    setState(() {
      _domain = _domainOf(addr);
      _remember = password != null && password.isNotEmpty;
      _loading = false;
    });
  }

  static String? _domainOf(String? addr) {
    if (addr == null || addr.isEmpty) return null;
    final uri = Uri.tryParse(addr);
    return (uri != null && uri.host.isNotEmpty) ? uri.host : addr;
  }

  /// 记住密码开关：关 → 删除已存密码；开且无已存密码 → 提示下次登录时保存。
  Future<void> _toggleRemember(bool value) async {
    if (value) {
      if (!_remember) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('无已保存密码，登录时勾选「记住密码」即可自动保存')),
        );
      }
      return;
    }
    await _secure.delete(key: _passwordKey);
    if (!mounted) return;
    setState(() => _remember = false);
  }

  Future<void> _logout() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('退出登录'),
        content: const Text('将清除本机的配对地址、登录凭证与记住的密码，需重新扫码配对。确定退出？'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('确认退出'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    await _secure.delete(key: _tokenKey);
    await _secure.delete(key: _passwordKey);
    await _secure.delete(key: _deviceIdKey);
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(ConnectionService.addrKey);
    widget.onLogout?.call();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('应用设置')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              children: [
                ListTile(
                  leading: const Icon(Icons.cloud_outlined),
                  title: const Text('服务器地址'),
                  subtitle: Text(_domain ?? '未配对'),
                ),
                const ListTile(
                  leading: Icon(Icons.verified_user_outlined),
                  title: Text('证书'),
                  subtitle: Text('HTTPS 正规域名证书（系统自动信任）'),
                ),
                const Divider(),
                SwitchListTile(
                  secondary: const Icon(Icons.password_outlined),
                  title: const Text('记住密码'),
                  subtitle: Text(_remember ? '已保存密码，下次自动填充' : '未保存密码'),
                  value: _remember,
                  onChanged: _toggleRemember,
                ),
                const Divider(),
                const ListTile(
                  leading: Icon(Icons.info_outline),
                  title: Text('关于'),
                  subtitle: Text('砼智 · 移动端 v0.1.0'),
                ),
                const Divider(),
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: FilledButton.tonalIcon(
                    key: const Key('logout-button'),
                    onPressed: _logout,
                    icon: const Icon(Icons.logout),
                    label: const Text('退出登录'),
                    style: FilledButton.styleFrom(
                      foregroundColor: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}
