// ignore_for_file: file_names
// 文件名 ConnectionService 为任务简报指定的 PascalCase 命名，保持原样。

import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// 扫码配对的结果。
///
/// `ok` 为 false 时仅 `error` 有效；成功时 `addr/code/domain` 有效。
class PairResult {
  const PairResult({
    required this.ok,
    this.error,
    this.addr,
    this.code,
    this.domain,
  });

  final bool ok;
  final String? error;
  final String? addr; // wss 地址（原样保存，供后续 WebSocket 连接）
  final String? code; // 8 位配对码
  final String? domain; // 从 addr 解析出的域名
}

/// 登录的结果，与服务端 `/api/login` 响应对齐。
class LoginResult {
  const LoginResult({
    required this.ok,
    this.token,
    this.deviceId,
    this.error,
    this.retryAfterMs,
    this.attemptsLeft,
  });

  final bool ok;
  final String? token; // 24h 有效 token，成功时写入 secure storage
  final String? deviceId;
  final String? error; // 失败原因：INVALID_CODE / DEVICE_NOT_PAIRED / LOCKED ...
  final int? retryAfterMs; // LOCKED 时剩余锁定毫秒数
  final int? attemptsLeft; // 剩余尝试次数
}

/// 连接配置服务：扫码配对 + 登录 + 本地安全存储。
///
/// - 配对：解析二维码 JSON `{"addr":"wss://<域名>/concrete/ws","code":"<8位>"}`，
///   保存 addr 到 shared_preferences（非敏感）。
/// - 登录：POST `https://<域名>/concrete/api/login`，token 存 flutter_secure_storage。
/// - 证书：腾讯云正规域名证书，系统自动受信任，不做任何跳过校验的处理。
class ConnectionService {
  ConnectionService({http.Client? httpClient, FlutterSecureStorage? secureStorage})
      : _http = httpClient ?? http.Client(),
        _secure = secureStorage ?? const FlutterSecureStorage();

  final http.Client _http;
  final FlutterSecureStorage _secure;

  static const addrKey = 'connection.addr';
  static const _tokenKey = 'auth.token';
  static const _deviceIdKey = 'auth.deviceId';
  static const _passwordKey = 'auth.password';

  /// 8 位字母数字配对码（服务端字符集为去混淆的大写字母 + 数字 2-9）。
  static final RegExp _codePattern = RegExp(r'^[A-Za-z0-9]{8}$');

  /// 解析二维码 JSON 并保存 wss 地址到本地。
  ///
  /// 二维码格式与电脑端 R10 统一：
  /// `{"addr":"wss://www.concreteagent.cloud/concrete/ws","code":"<8位>"}`
  Future<PairResult> pair(String qrData) async {
    final Map<String, dynamic> json;
    try {
      final decoded = jsonDecode(qrData);
      if (decoded is! Map<String, dynamic>) {
        return const PairResult(ok: false, error: 'INVALID_JSON');
      }
      json = decoded;
    } catch (_) {
      return const PairResult(ok: false, error: 'INVALID_JSON');
    }

    final addr = json['addr'];
    final code = json['code'];
    if (addr is! String || addr.isEmpty) {
      return const PairResult(ok: false, error: 'MISSING_ADDR');
    }
    if (code is! String || !_codePattern.hasMatch(code)) {
      return const PairResult(ok: false, error: 'INVALID_CODE');
    }

    final uri = Uri.tryParse(addr);
    if (uri == null || (uri.scheme != 'ws' && uri.scheme != 'wss') || uri.host.isEmpty) {
      return const PairResult(ok: false, error: 'INVALID_ADDR');
    }

    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(addrKey, addr);

    return PairResult(ok: true, addr: addr, code: code, domain: uri.host);
  }

  /// 用密码 + 设备 ID 登录，token 写入 secure storage。
  ///
  /// - [remember] 为 true 时密码一并写入 secure storage（记住密码）；
  ///   为 false（默认）时不保存密码，并清除之前记住的密码。
  /// - 域名从已配对保存的 addr 解析：`wss://<域名>/concrete/ws` → `https://<域名>/concrete/api/login`。
  Future<LoginResult> login(
    String password,
    String deviceId, {
    bool remember = false,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    final addr = prefs.getString(addrKey);
    if (addr == null || addr.isEmpty) {
      return const LoginResult(ok: false, error: 'NOT_PAIRED');
    }

    final uri = Uri.tryParse(addr);
    if (uri == null || uri.host.isEmpty) {
      return const LoginResult(ok: false, error: 'INVALID_ADDR');
    }
    // wss → https，ws → http；正式环境使用腾讯云正规域名证书，系统自动信任
    final scheme = uri.scheme == 'wss' ? 'https' : 'http';
    final loginUrl = Uri.parse('$scheme://${uri.host}/concrete/api/login');

    final http.Response resp;
    try {
      resp = await _http.post(
        loginUrl,
        headers: {'Content-Type': 'application/json; charset=utf-8'},
        body: jsonEncode({'password': password, 'deviceId': deviceId}),
      );
    } catch (_) {
      return const LoginResult(ok: false, error: 'NETWORK_ERROR');
    }

    final Map<String, dynamic> body;
    try {
      final decoded = jsonDecode(resp.body);
      if (decoded is! Map<String, dynamic>) {
        return const LoginResult(ok: false, error: 'BAD_RESPONSE');
      }
      body = decoded;
    } catch (_) {
      return const LoginResult(ok: false, error: 'BAD_RESPONSE');
    }

    if (body['ok'] != true) {
      return LoginResult(
        ok: false,
        error: body['error'] as String? ?? 'LOGIN_FAILED',
        retryAfterMs: (body['retryAfterMs'] as num?)?.toInt(),
        attemptsLeft: (body['attemptsLeft'] as num?)?.toInt(),
      );
    }

    final token = body['token'] as String?;
    if (token == null || token.isEmpty) {
      return const LoginResult(ok: false, error: 'MISSING_TOKEN');
    }

    await _secure.write(key: _tokenKey, value: token);
    await saveDeviceId(deviceId);

    if (remember) {
      await setPassword(password);
    } else {
      await _secure.delete(key: _passwordKey);
    }

    return LoginResult(ok: true, token: token, deviceId: deviceId);
  }

  // ---------- secure storage 封装 ----------

  Future<String?> getToken() => _secure.read(key: _tokenKey);

  Future<String?> getDeviceId() => _secure.read(key: _deviceIdKey);

  Future<void> saveDeviceId(String id) =>
      _secure.write(key: _deviceIdKey, value: id);

  Future<String?> getPassword() => _secure.read(key: _passwordKey);

  Future<void> setPassword(String pw) =>
      _secure.write(key: _passwordKey, value: pw);
}
