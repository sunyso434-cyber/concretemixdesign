// ignore_for_file: file_names
// 文件名 ConnectionService_test 为任务简报指定的 PascalCase 命名，保持原样。

import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:concrete_agent/services/ConnectionService.dart';
import 'package:flutter_test/flutter_test.dart';

/// MockClient：任何请求都抛错，用于断言「不应发起 HTTP」的路径（如二维码解析失败）。
MockClient _noHttpClient() => MockClient(
      (request) async => throw StateError('不应发起 HTTP 请求'),
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const addr = 'wss://www.concreteagent.cloud/concrete/ws';
  const domain = 'www.concreteagent.cloud';

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    SharedPreferences.setMockInitialValues({});
  });

  group('ConnectionService.pair - 二维码解析 + 服务端注册', () {
    test('解析合法二维码，POST /api/pair 注册设备并保存 addr + 服务端 deviceId',
        () async {
      http.Request? captured;
      final mock = MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({'ok': true, 'deviceId': 'dev_1234567890abcdef'}),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });
      final svc = ConnectionService(httpClient: mock);

      final result = await svc.pair(
        '{"addr":"$addr","code":"12345678"}',
      );

      expect(result.ok, isTrue);
      expect(result.addr, addr);
      expect(result.code, '12345678');
      expect(result.domain, domain);
      expect(result.deviceId, 'dev_1234567890abcdef');

      // POST 到 https://域名/concrete/api/pair，body 携带 code
      expect(captured, isNotNull);
      expect(captured!.method, 'POST');
      expect(captured!.url.toString(), 'https://$domain/concrete/api/pair');
      final body = jsonDecode(captured!.body) as Map<String, dynamic>;
      expect(body['code'], '12345678');

      // addr（prefs）+ 服务端 deviceId（secure storage）均落本地
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('connection.addr'), addr);
      expect(await svc.getDeviceId(), 'dev_1234567890abcdef');
    });

    test('配对成功后 deviceId 为服务端签发格式（dev_ 下划线，非本地拼的短横线）',
        () async {
      final mock = MockClient((request) async => http.Response(
            jsonEncode({'ok': true, 'deviceId': 'dev_1a2b3c4d5e6f7890'}),
            200,
          ));
      final svc = ConnectionService(httpClient: mock);

      final result = await svc.pair('{"addr":"$addr","code":"ABCD2345"}');

      expect(result.ok, isTrue);
      expect(result.deviceId, matches(RegExp(r'^dev_[0-9a-f]{16}$')));
      expect(result.deviceId, isNot(contains('-')));
    });

    test('配对接口网络失败返回 NETWORK_ERROR 且不保存 addr', () async {
      final mock = MockClient(
        (request) async => throw http.ClientException('connection refused'),
      );
      final svc = ConnectionService(httpClient: mock);

      final result = await svc.pair('{"addr":"$addr","code":"12345678"}');

      expect(result.ok, isFalse);
      expect(result.error, 'NETWORK_ERROR');
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('connection.addr'), isNull);
      expect(await svc.getDeviceId(), isNull);
    });

    test('服务端配对失败（INVALID_CODE）透传错误且不保存 addr', () async {
      final mock = MockClient((request) async => http.Response(
            jsonEncode({'ok': false, 'error': 'INVALID_CODE'}),
            200,
          ));
      final svc = ConnectionService(httpClient: mock);

      final result = await svc.pair('{"addr":"$addr","code":"99999999"}');

      expect(result.ok, isFalse);
      expect(result.error, 'INVALID_CODE');
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('connection.addr'), isNull);
    });

    test('非法 JSON 返回 INVALID_JSON（不发请求）', () async {
      final svc = ConnectionService(httpClient: _noHttpClient());
      final result = await svc.pair('not-a-json{{');

      expect(result.ok, isFalse);
      expect(result.error, 'INVALID_JSON');
    });

    test('缺少 addr 返回 MISSING_ADDR（不发请求）', () async {
      final svc = ConnectionService(httpClient: _noHttpClient());
      final result = await svc.pair('{"code":"12345678"}');

      expect(result.ok, isFalse);
      expect(result.error, 'MISSING_ADDR');
    });

    test('code 非 8 位字母数字返回 INVALID_CODE（不发请求）', () async {
      final svc = ConnectionService(httpClient: _noHttpClient());
      expect((await svc.pair('{"addr":"$addr","code":"1234"}')).error,
          'INVALID_CODE');
      expect((await svc.pair('{"addr":"$addr","code":"123456789"}')).error,
          'INVALID_CODE');
      expect(
          (await svc.pair('{"addr":"$addr","code":"ABCD EFG"}')).error,
          'INVALID_CODE');
    });

    test('addr 协议非法返回 INVALID_ADDR（不发请求）', () async {
      final svc = ConnectionService(httpClient: _noHttpClient());
      final result = await svc.pair(
        '{"addr":"http://www.concreteagent.cloud/x","code":"12345678"}',
      );

      expect(result.ok, isFalse);
      expect(result.error, 'INVALID_ADDR');
    });
  });

  group('ConnectionService.login - 登录', () {
    test('POST 到 https://域名/concrete/api/login 并携带 deviceId/password', () async {
      http.Request? captured;
      final mock = MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({'ok': true, 'token': 'tok-abc', 'deviceId': 'dev-1'}),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });
      SharedPreferences.setMockInitialValues({'connection.addr': addr});
      final svc = ConnectionService(httpClient: mock);

      final result =
          await svc.login('pw123', 'dev-1');

      expect(captured, isNotNull);
      expect(captured!.method, 'POST');
      expect(captured!.url.toString(),
          'https://$domain/concrete/api/login');
      final body = jsonDecode(captured!.body) as Map<String, dynamic>;
      expect(body['password'], 'pw123');
      expect(body['deviceId'], 'dev-1');

      expect(result.ok, isTrue);
      expect(result.token, 'tok-abc');
    });

    test('登录成功后 token 与 deviceId 写入 secure storage', () async {
      final mock = MockClient((request) async => http.Response(
            jsonEncode({'ok': true, 'token': 'tok-abc', 'deviceId': 'dev-1'}),
            200,
          ));
      SharedPreferences.setMockInitialValues({'connection.addr': addr});
      final svc = ConnectionService(httpClient: mock);

      await svc.login('pw123', 'dev-1');

      expect(await svc.getToken(), 'tok-abc');
      expect(await svc.getDeviceId(), 'dev-1');
    });

    test('登录失败返回错误且不保存 token', () async {
      final mock = MockClient((request) async => http.Response(
            jsonEncode({
              'ok': false,
              'error': 'LOCKED',
              'retryAfterMs': 3000,
              'attemptsLeft': 0,
            }),
            200,
          ));
      SharedPreferences.setMockInitialValues({'connection.addr': addr});
      final svc = ConnectionService(httpClient: mock);

      final result = await svc.login('wrong', 'dev-1');

      expect(result.ok, isFalse);
      expect(result.error, 'LOCKED');
      expect(result.retryAfterMs, 3000);
      expect(await svc.getToken(), isNull);
    });

    test('未配对（本地无 addr）返回 NOT_PAIRED 且不发请求', () async {
      var requestCount = 0;
      final mock = MockClient((request) async {
        requestCount++;
        return http.Response('{}', 500);
      });
      final svc = ConnectionService(httpClient: mock);

      final result = await svc.login('pw', 'dev');

      expect(result.ok, isFalse);
      expect(result.error, 'NOT_PAIRED');
      expect(requestCount, 0);
    });

    test('配对后 login 使用服务端签发的 deviceId（C1）', () async {
      http.Request? captured;
      final mock = MockClient((request) async {
        captured = request;
        if (request.url.path.endsWith('/api/pair')) {
          return http.Response(
            jsonEncode({'ok': true, 'deviceId': 'dev_abcdef1234567890'}),
            200,
          );
        }
        return http.Response(
          jsonEncode({'ok': true, 'token': 'tok', 'deviceId': 'dev_abcdef1234567890'}),
          200,
        );
      });
      final svc = ConnectionService(httpClient: mock);

      // 先配对：服务端签发 deviceId 并落本地
      final pair = await svc.pair('{"addr":"$addr","code":"12345678"}');
      expect(pair.ok, isTrue);
      final deviceId = await svc.getDeviceId();
      expect(deviceId, 'dev_abcdef1234567890');

      // 登录直接用它，不再本地生成
      final result = await svc.login('pw', deviceId!);
      expect(result.ok, isTrue);
      final body = jsonDecode(captured!.body) as Map<String, dynamic>;
      expect(body['deviceId'], 'dev_abcdef1234567890');
    });
  });

  group('ConnectionService - secure storage 往返', () {
    test('saveDeviceId/getDeviceId 往返', () async {
      final svc = ConnectionService();
      expect(await svc.getDeviceId(), isNull);
      await svc.saveDeviceId('device-42');
      expect(await svc.getDeviceId(), 'device-42');
    });

    test('setPassword/getPassword 往返', () async {
      final svc = ConnectionService();
      expect(await svc.getPassword(), isNull);
      await svc.setPassword('secret-pw');
      expect(await svc.getPassword(), 'secret-pw');
    });
  });

  group('ConnectionService - 记住密码开关', () {
    test('remember=true 时密码写入 secure storage', () async {
      final mock = MockClient((request) async => http.Response(
            jsonEncode({'ok': true, 'token': 'tok', 'deviceId': 'dev'}),
            200,
          ));
      SharedPreferences.setMockInitialValues({'connection.addr': addr});
      final svc = ConnectionService(httpClient: mock);

      await svc.login('pw123', 'dev-1', remember: true);

      expect(await svc.getPassword(), 'pw123');
      expect(await svc.getToken(), 'tok');
    });

    test('remember 默认关闭：密码不写入 secure storage', () async {
      final mock = MockClient((request) async => http.Response(
            jsonEncode({'ok': true, 'token': 'tok', 'deviceId': 'dev'}),
            200,
          ));
      SharedPreferences.setMockInitialValues({'connection.addr': addr});
      final svc = ConnectionService(httpClient: mock);

      await svc.login('pw123', 'dev-1');

      expect(await svc.getPassword(), isNull);
    });

    test('remember=false 会清除之前记住的密码', () async {
      final mock = MockClient((request) async => http.Response(
            jsonEncode({'ok': true, 'token': 'tok', 'deviceId': 'dev'}),
            200,
          ));
      SharedPreferences.setMockInitialValues({'connection.addr': addr});
      final svc = ConnectionService(httpClient: mock);

      // 先记住密码
      await svc.setPassword('old-pw');
      expect(await svc.getPassword(), 'old-pw');

      // 关闭记住后登录，密码应被清除
      await svc.login('new-pw', 'dev-1', remember: false);

      expect(await svc.getPassword(), isNull);
    });
  });
}
