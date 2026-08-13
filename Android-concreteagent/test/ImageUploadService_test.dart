// ignore_for_file: file_names
// 文件名 ImageUploadService_test 为任务简报指定的 PascalCase 命名，保持原样。

import 'dart:convert';
import 'dart:io';

import 'package:concrete_agent/services/ImageUploadService.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 在系统临时目录创建一张真实小图，测试结束自动清理。
Future<File> makeTempImage(String name, List<int> bytes) async {
  final dir = await Directory.systemTemp.createTemp('img_upload_test');
  addTearDown(() async {
    try {
      await dir.delete(recursive: true);
    } catch (_) {}
  });
  final file = File('${dir.path}${Platform.pathSeparator}$name');
  await file.writeAsBytes(bytes);
  return file;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const addr = 'wss://www.concreteagent.cloud/concrete/ws';

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('ImageUploadService.uploadImage', () {
    test('POST 原始字节到 https://域名/concrete/api/image，带 Bearer 与 X-Filename 头', () async {
      final bytes = <int>[0x89, 0x50, 0x4E, 0x47, 1, 2, 3, 4];
      final file = await makeTempImage('photo.jpg', bytes);

      http.Request? captured;
      final mock = MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'ok': true,
            'path': '/workspace/raw/images/photo_1.jpg',
            'name': 'photo_1.jpg',
          }),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });
      SharedPreferences.setMockInitialValues({'connection.addr': addr});
      final svc = ImageUploadService(httpClient: mock);

      final result = await svc.uploadImage(file.path, 'tok-abc');

      expect(captured, isNotNull);
      expect(captured!.method, 'POST');
      expect(captured!.url.toString(),
          'https://www.concreteagent.cloud/concrete/api/image');
      expect(captured!.headers['Authorization'], 'Bearer tok-abc');
      expect(captured!.headers['X-Filename'], 'photo.jpg');
      // body 是原始图片字节（与电脑端 R9 流式读 body 一致，非 multipart）
      expect(captured!.bodyBytes, bytes);

      expect(result.ok, isTrue);
      expect(result.path, '/workspace/raw/images/photo_1.jpg');
      expect(result.name, 'photo_1.jpg');
    });

    test('超过 50MB 本地拒绝（IMAGE_TOO_LARGE）且不发网络请求', () async {
      final dir = await Directory.systemTemp.createTemp('img_upload_test');
      addTearDown(() async {
        try {
          await dir.delete(recursive: true);
        } catch (_) {}
      });
      final file = File('${dir.path}${Platform.pathSeparator}big.jpg');
      await file.writeAsBytes(List<int>.filled(50 * 1024 * 1024 + 1, 0));

      var requestCount = 0;
      final mock = MockClient((request) async {
        requestCount++;
        return http.Response('{}', 500);
      });
      SharedPreferences.setMockInitialValues({'connection.addr': addr});
      final svc = ImageUploadService(httpClient: mock);

      final result = await svc.uploadImage(file.path, 'tok');

      expect(result.ok, isFalse);
      expect(result.error, 'IMAGE_TOO_LARGE');
      expect(requestCount, 0);
    });

    test('文件不存在返回 FILE_NOT_FOUND 且不发网络请求', () async {
      var requestCount = 0;
      final mock = MockClient((request) async {
        requestCount++;
        return http.Response('{}', 500);
      });
      SharedPreferences.setMockInitialValues({'connection.addr': addr});
      final svc = ImageUploadService(httpClient: mock);

      final result = await svc.uploadImage('/not/exist/photo.jpg', 'tok');

      expect(result.ok, isFalse);
      expect(result.error, 'FILE_NOT_FOUND');
      expect(requestCount, 0);
    });

    test('未配对（本地无 addr）返回 NOT_PAIRED 且不发网络请求', () async {
      final file = await makeTempImage('a.png', [1, 2, 3]);
      var requestCount = 0;
      final mock = MockClient((request) async {
        requestCount++;
        return http.Response('{}', 500);
      });
      final svc = ImageUploadService(httpClient: mock);

      final result = await svc.uploadImage(file.path, 'tok');

      expect(result.ok, isFalse);
      expect(result.error, 'NOT_PAIRED');
      expect(requestCount, 0);
    });

    test('服务端返回 ok:false 时透传 error（如 UNSUPPORTED_TYPE）', () async {
      final file = await makeTempImage('a.gif', [1, 2, 3]);
      final mock = MockClient((request) async => http.Response(
            jsonEncode({'ok': false, 'error': 'UNSUPPORTED_TYPE'}),
            415,
          ));
      SharedPreferences.setMockInitialValues({'connection.addr': addr});
      final svc = ImageUploadService(httpClient: mock);

      final result = await svc.uploadImage(file.path, 'tok');

      expect(result.ok, isFalse);
      expect(result.error, 'UNSUPPORTED_TYPE');
    });

    test('网络异常返回 NETWORK_ERROR', () async {
      final file = await makeTempImage('b.png', [9, 9]);
      final mock = MockClient((request) async => throw const SocketException('down'));
      SharedPreferences.setMockInitialValues({'connection.addr': addr});
      final svc = ImageUploadService(httpClient: mock);

      final result = await svc.uploadImage(file.path, 'tok');

      expect(result.ok, isFalse);
      expect(result.error, 'NETWORK_ERROR');
    });

    test('网络类失败自动重试一次：第一次网络异常、第二次成功 → 上传成功', () async {
      final file = await makeTempImage('retry.jpg', [1, 2, 3, 4]);
      var requestCount = 0;
      final mock = MockClient((request) async {
        requestCount++;
        if (requestCount == 1) throw const SocketException('jitter');
        return http.Response(
          jsonEncode({'ok': true, 'path': '/ws/raw/images/retry.jpg', 'name': 'retry.jpg'}),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });
      SharedPreferences.setMockInitialValues({'connection.addr': addr});
      final svc = ImageUploadService(httpClient: mock);

      final result = await svc.uploadImage(file.path, 'tok');

      expect(requestCount, 2);
      expect(result.ok, isTrue);
      expect(result.path, '/ws/raw/images/retry.jpg');
    });

    test('网络类失败两次都失败 → NETWORK_ERROR，共请求 2 次', () async {
      final file = await makeTempImage('retry2.jpg', [1, 2]);
      var requestCount = 0;
      final mock = MockClient((request) async {
        requestCount++;
        throw const SocketException('down');
      });
      SharedPreferences.setMockInitialValues({'connection.addr': addr});
      final svc = ImageUploadService(httpClient: mock);

      final result = await svc.uploadImage(file.path, 'tok');

      expect(requestCount, 2);
      expect(result.ok, isFalse);
      expect(result.error, 'NETWORK_ERROR');
    });

    test('上传超时返回 UPLOAD_TIMEOUT（超时后自动重试一次，仍超时）', () async {
      final file = await makeTempImage('slow.jpg', [1, 2, 3]);
      var requestCount = 0;
      final mock = MockClient((request) async {
        requestCount++;
        await Future<void>.delayed(const Duration(milliseconds: 300));
        return http.Response('{}', 500);
      });
      SharedPreferences.setMockInitialValues({'connection.addr': addr});
      final svc = ImageUploadService(
        httpClient: mock,
        uploadTimeout: const Duration(milliseconds: 50),
      );

      final result = await svc.uploadImage(file.path, 'tok');

      expect(requestCount, 2);
      expect(result.ok, isFalse);
      expect(result.error, 'UPLOAD_TIMEOUT');
    });

    test('服务端明确错误（ok:false）不重试：UNSUPPORTED_TYPE 只请求 1 次', () async {
      final file = await makeTempImage('a.gif', [1, 2, 3]);
      var requestCount = 0;
      final mock = MockClient((request) async {
        requestCount++;
        return http.Response(jsonEncode({'ok': false, 'error': 'UNSUPPORTED_TYPE'}), 415);
      });
      SharedPreferences.setMockInitialValues({'connection.addr': addr});
      final svc = ImageUploadService(httpClient: mock);

      final result = await svc.uploadImage(file.path, 'tok');

      expect(requestCount, 1);
      expect(result.ok, isFalse);
      expect(result.error, 'UNSUPPORTED_TYPE');
    });

    test('响应非 JSON 返回 BAD_RESPONSE', () async {
      final file = await makeTempImage('c.jpg', [1]);
      final mock = MockClient((request) async => http.Response('<html>', 500));
      SharedPreferences.setMockInitialValues({'connection.addr': addr});
      final svc = ImageUploadService(httpClient: mock);

      final result = await svc.uploadImage(file.path, 'tok');

      expect(result.ok, isFalse);
      expect(result.error, 'BAD_RESPONSE');
    });
  });
}
