// ignore_for_file: file_names
// 文件名 ImageUploadService 为任务简报指定的 PascalCase 命名，保持原样。

import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'ConnectionService.dart';

/// 图片上传的结果。
///
/// `ok` 为 false 时仅 `error` 有效（`IMAGE_TOO_LARGE` / `NOT_PAIRED` /
/// `NETWORK_ERROR` 等，或服务端返回的 error 原样透传）；
/// 成功时 `path` 为服务端保存后的绝对路径（供 `agent:run` 的 imageRefs 使用），
/// `name` 为服务端落盘后的文件名（重名时可能带时间戳）。
class UploadResult {
  const UploadResult({
    required this.ok,
    this.path,
    this.name,
    this.error,
  });

  final bool ok;
  final String? path;
  final String? name;
  final String? error;
}

/// 图片上传服务：POST `https://<域名>/concrete/api/image`。
///
/// 协议与电脑端 R9 `RemoteImageApi.handleUpload` 对齐：
/// - **鉴权**：`Authorization: Bearer <token>` 头（token 由调用方传入）
/// - **文件名**：`X-Filename` 头（服务端 query ?name= 与 X-Filename 二选一，此处置头）
/// - **body**：原始图片字节（服务端流式读 body 落盘；**不是 multipart**——
///   发 multipart 会把 boundary 头也写进图片文件，导致图片损坏）
/// - **大小限制**：≤10MB，超限本地直接拒绝（不发请求），避免浪费带宽
/// - **域名**：从 ConnectionService 扫码配对时保存的 addr 解析，
///   `wss://<域名>/concrete/ws` → `https://<域名>/concrete/api/image`
///
/// 证书：腾讯云正规域名证书，系统自动受信任，不含任何跳过校验逻辑。
class ImageUploadService {
  ImageUploadService({http.Client? httpClient})
      : _http = httpClient ?? http.Client();

  final http.Client _http;

  /// 图片大小上限（与电脑端 R9 MAX_IMAGE_BYTES 一致）：10MB。
  static const int maxImageBytes = 10 * 1024 * 1024;

  /// 上传一张图片。
  ///
  /// [path] 为本地图片绝对路径（image_picker 返回）；[token] 为登录 token。
  /// 返回的 `path` 直接可放进 `agent:run` 的 `imageRefs: [{ path }]`。
  Future<UploadResult> uploadImage(String path, String token) async {
    // 1. 本地校验：文件存在 + ≤10MB（先于网络，超限不发请求）
    final File file = File(path);
    final int length;
    try {
      length = await file.length();
    } catch (_) {
      return const UploadResult(ok: false, error: 'FILE_NOT_FOUND');
    }
    if (length > maxImageBytes) {
      return const UploadResult(ok: false, error: 'IMAGE_TOO_LARGE');
    }

    // 2. 域名：从配对保存的 addr 解析（wss → https）
    final prefs = await SharedPreferences.getInstance();
    final addr = prefs.getString(ConnectionService.addrKey);
    if (addr == null || addr.isEmpty) {
      return const UploadResult(ok: false, error: 'NOT_PAIRED');
    }
    final Uri? addrUri = Uri.tryParse(addr);
    if (addrUri == null ||
        (addrUri.scheme != 'ws' && addrUri.scheme != 'wss') ||
        addrUri.host.isEmpty) {
      return const UploadResult(ok: false, error: 'INVALID_ADDR');
    }
    final scheme = addrUri.scheme == 'wss' ? 'https' : 'http';
    final uploadUrl = Uri.parse('$scheme://${addrUri.host}/concrete/api/image');

    // 3. 文件名：取路径最后一段（basename），随 X-Filename 头上传
    final name = path.split(RegExp(r'[\\/]')).last;

    // 4. 读字节 + POST 原始 body
    final List<int> bytes;
    try {
      bytes = await file.readAsBytes();
    } catch (_) {
      return const UploadResult(ok: false, error: 'FILE_READ_ERROR');
    }

    final http.Response resp;
    try {
      resp = await _http.post(
        uploadUrl,
        headers: {
          'Authorization': 'Bearer $token',
          'X-Filename': name,
          'Content-Type': 'application/octet-stream',
        },
        body: bytes,
      );
    } catch (_) {
      return const UploadResult(ok: false, error: 'NETWORK_ERROR');
    }

    // 5. 解析 JSON 响应（与 R9 `{ ok, path, name }` / `{ ok, error }` 对齐）
    final Map<String, dynamic> body;
    try {
      final decoded = jsonDecode(resp.body);
      if (decoded is! Map<String, dynamic>) {
        return const UploadResult(ok: false, error: 'BAD_RESPONSE');
      }
      body = decoded;
    } catch (_) {
      return const UploadResult(ok: false, error: 'BAD_RESPONSE');
    }

    if (body['ok'] != true) {
      return UploadResult(
        ok: false,
        error: body['error'] as String? ?? 'UPLOAD_FAILED',
      );
    }

    final savedPath = body['path'] as String?;
    if (savedPath == null || savedPath.isEmpty) {
      return const UploadResult(ok: false, error: 'MISSING_PATH');
    }

    return UploadResult(
      ok: true,
      path: savedPath,
      name: body['name'] as String? ?? name,
    );
  }
}
