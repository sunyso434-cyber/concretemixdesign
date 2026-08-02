// ignore_for_file: file_names
// 文件名 app_test 为任务简报指定的 PascalCase 命名，保持原样。

import 'dart:async';
import 'dart:convert';

import 'package:concrete_agent/app.dart';
import 'package:concrete_agent/pages/ChatPage.dart';
import 'package:concrete_agent/pages/LoginPage.dart';
import 'package:concrete_agent/pages/PairPage.dart';
import 'package:concrete_agent/pages/SessionsPage.dart';
import 'package:concrete_agent/pages/WorkspacePage.dart';
import 'package:concrete_agent/services/ConnectionService.dart';
import 'package:concrete_agent/services/RemoteClient.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 测试用 RemoteClient 替身（同既有页面测试）：记录发送/连接、可注入服务端事件。
class FakeRemoteClient implements RemoteClient {
  FakeRemoteClient({bool connected = true}) : _connected = connected;

  final List<(String, Map<String, dynamic>)> sent = [];
  final StreamController<Map<String, dynamic>> _events =
      StreamController<Map<String, dynamic>>.broadcast();
  bool _connected;
  int connectCount = 0;

  @override
  Stream<Map<String, dynamic>> get events => _events.stream;

  @override
  bool get isConnected => _connected;

  @override
  Future<void> connect(String url, String token) async {
    connectCount++;
    _connected = true;
  }

  @override
  void send(String type, Map<String, dynamic> payload) {
    sent.add((type, Map.of(payload)));
  }

  @override
  Future<void> close() async {}

  void emit(Map<String, dynamic> message) => _events.add(message);

  List<Map<String, dynamic>> sentOf(String type) =>
      sent.where((s) => s.$1 == type).map((s) => s.$2).toList();
}

const addr = 'wss://www.concreteagent.cloud/concrete/ws';
const validQr = '{"addr":"$addr","code":"12345678"}';

/// 登录成功的 ConnectionService（MockClient 回 ok + token）。
ConnectionService loginOkService() => ConnectionService(
      httpClient: MockClient((request) async => http.Response(
            jsonEncode({'ok': true, 'token': 'tok-abc', 'deviceId': 'dev-1'}),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          )),
    );

/// 挂载 ConcreteApp（注入 fake 客户端 + fake 扫码器，模拟扫码返回 [qrText]），
/// 测试结束后卸载以清理轮询 Timer。
Future<void> pumpApp(
  WidgetTester tester,
  FakeRemoteClient fake, {
  ConnectionService? svc,
  String? qrText,
}) async {
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox());
  });
  await tester.pumpWidget(
    ConcreteApp(
      connectionService: svc ?? ConnectionService(),
      client: fake,
      scannerBuilder: (context, onDetect) => Column(
        children: [
          const Text('扫码区域'),
          TextButton(
            onPressed: () => onDetect(qrText ?? validQr),
            child: const Text('模拟扫码'),
          ),
        ],
      ),
    ),
  );
  // 推进冷启动异步初始化（mocked 存储 / fake 连接均为微任务）。
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 50));
  await settleHome(tester, fake);
}

/// 若已进入主页：喂空列表响应让会话/工作区页结束 loading spinner，
/// 再 settle。否则（配对/登录页）直接 settle。
///
/// 主页三页挂载后，SessionsPage/WorkspacePage 的 loading spinner 是无限动画，
/// 不喂响应的话 pumpAndSettle 会因一直有帧调度而超时挂起。
Future<void> settleHome(WidgetTester tester, FakeRemoteClient fake) async {
  for (var i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 20));
    if (find.byType(NavigationBar).evaluate().isNotEmpty) break;
  }
  if (find.byType(NavigationBar).evaluate().isNotEmpty) {
    fake.emit({
      'channel': 'agent:listSessions',
      'payload': {
        'requestId': 'req-0',
        'success': true,
        'sessions': <dynamic>[],
      },
    });
    fake.emit({
      'channel': 'workspace:listRecent',
      'payload': {
        'requestId': 'req-0',
        'success': true,
        'recent': <dynamic>[],
      },
    });
    fake.emit({
      'channel': 'workspace:current',
      'payload': {
        'requestId': 'req-0',
        'success': true,
        'path': null,
      },
    });
    await tester.pumpAndSettle();
    return;
  }
  await tester.pumpAndSettle();
}

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    SharedPreferences.setMockInitialValues({});
  });

  group('冷启动路由', () {
    testWidgets('无配对地址 → 显示 PairPage', (tester) async {
      final fake = FakeRemoteClient();
      await pumpApp(tester, fake);

      expect(find.byType(PairPage), findsOneWidget);
    });

    testWidgets('有配对地址无 token → 显示 LoginPage', (tester) async {
      SharedPreferences.setMockInitialValues({'connection.addr': addr});
      final fake = FakeRemoteClient();
      await pumpApp(tester, fake);

      expect(find.byType(LoginPage), findsOneWidget);
    });

    testWidgets('有配对地址 + token → 进入主页（三页共享同一客户端）', (tester) async {
      SharedPreferences.setMockInitialValues({'connection.addr': addr});
      FlutterSecureStorage.setMockInitialValues({'auth.token': 'tok'});
      final fake = FakeRemoteClient();
      await pumpApp(tester, fake);

      expect(find.byType(NavigationBar), findsOneWidget);
      expect(fake.connectCount, greaterThanOrEqualTo(1));

      // 三页共享同一个 RemoteClient 单例（F6 共享模式，导航层维护单例）。
      final sessions =
          tester.widget<SessionsPage>(find.byType(SessionsPage, skipOffstage: false));
      final chat =
          tester.widget<ChatPage>(find.byType(ChatPage, skipOffstage: false));
      final workspace =
          tester.widget<WorkspacePage>(find.byType(WorkspacePage, skipOffstage: false));
      expect(identical(sessions.client, fake), isTrue);
      expect(identical(chat.client, fake), isTrue);
      expect(identical(workspace.client, fake), isTrue);
    });
  });

  group('配对流程', () {
    testWidgets('扫码配对成功 → 进入 LoginPage', (tester) async {
      final fake = FakeRemoteClient();
      await pumpApp(tester, fake);
      expect(find.byType(PairPage), findsOneWidget);

      await tester.tap(find.text('模拟扫码'));
      await tester.pumpAndSettle();

      expect(find.byType(LoginPage), findsOneWidget);
    });

    testWidgets('扫码配对失败 → 显示错误并停留 PairPage', (tester) async {
      final fake = FakeRemoteClient();
      await pumpApp(tester, fake, qrText: 'not-a-json{{');
      expect(find.byType(PairPage), findsOneWidget);

      await tester.tap(find.text('模拟扫码'));
      await tester.pumpAndSettle();

      expect(find.byType(PairPage), findsOneWidget);
      expect(find.textContaining('二维码格式错误'), findsOneWidget);
    });
  });

  group('登录流程', () {
    testWidgets('登录成功 → 进入主页', (tester) async {
      SharedPreferences.setMockInitialValues({'connection.addr': addr});
      final fake = FakeRemoteClient();
      await pumpApp(tester, fake, svc: loginOkService());
      expect(find.byType(LoginPage), findsOneWidget);

      await tester.enterText(find.byType(TextField), 'pw123');
      await tester.tap(find.byKey(const Key('login-button')));
      await settleHome(tester, fake);

      expect(find.byType(NavigationBar), findsOneWidget);
      expect(fake.connectCount, greaterThanOrEqualTo(1));
    });

    testWidgets('登录失败 → 显示错误并停留 LoginPage', (tester) async {
      SharedPreferences.setMockInitialValues({'connection.addr': addr});
      final svc = ConnectionService(
        httpClient: MockClient((request) async => http.Response(
              jsonEncode({
                'ok': false,
                'error': 'WRONG_PASSWORD',
                'attemptsLeft': 3,
              }),
              200,
            )),
      );
      final fake = FakeRemoteClient();
      await pumpApp(tester, fake, svc: svc);
      expect(find.byType(LoginPage), findsOneWidget);

      await tester.enterText(find.byType(TextField), 'wrong');
      await tester.tap(find.byKey(const Key('login-button')));
      await tester.pumpAndSettle();

      expect(find.byType(LoginPage), findsOneWidget);
      expect(find.text('密码错误，剩余 3 次机会'), findsOneWidget);
    });
  });

  group('auth_rejected 全局处理（F7 评审 I1）', () {
    testWidgets('主页时收到 auth_rejected → 回 LoginPage 并提示', (tester) async {
      SharedPreferences.setMockInitialValues({'connection.addr': addr});
      FlutterSecureStorage.setMockInitialValues({'auth.token': 'tok'});
      final fake = FakeRemoteClient();
      await pumpApp(tester, fake);
      expect(find.byType(NavigationBar), findsOneWidget);

      fake.emit({'type': 'auth_rejected'});
      await tester.pumpAndSettle();

      expect(find.byType(LoginPage), findsOneWidget);
      expect(find.text('登录已过期，请重新登录'), findsOneWidget);
    });

    testWidgets('主页时收到服务端 error/AUTH_FAILED → 回 LoginPage', (tester) async {
      SharedPreferences.setMockInitialValues({'connection.addr': addr});
      FlutterSecureStorage.setMockInitialValues({'auth.token': 'tok'});
      final fake = FakeRemoteClient();
      await pumpApp(tester, fake);
      expect(find.byType(NavigationBar), findsOneWidget);

      fake.emit({'type': 'error', 'error': 'AUTH_FAILED'});
      await tester.pumpAndSettle();

      expect(find.byType(LoginPage), findsOneWidget);
    });
  });

  group('底部导航', () {
    testWidgets('主页 4 tab 切换', (tester) async {
      SharedPreferences.setMockInitialValues({'connection.addr': addr});
      FlutterSecureStorage.setMockInitialValues({'auth.token': 'tok'});
      final fake = FakeRemoteClient();
      await pumpApp(tester, fake);
      expect(find.byType(NavigationBar), findsOneWidget);

      NavigationBar nav() =>
          tester.widget<NavigationBar>(find.byType(NavigationBar));
      expect(nav().selectedIndex, 0);

      await tester.tap(find.text('对话'));
      await tester.pumpAndSettle();
      expect(nav().selectedIndex, 1);

      await tester.tap(find.text('工作区'));
      await tester.pumpAndSettle();
      expect(nav().selectedIndex, 2);

      await tester.tap(find.text('设置'));
      await tester.pumpAndSettle();
      expect(nav().selectedIndex, 3);
    });
  });

  group('退出登录', () {
    testWidgets('设置页退出登录 → 清 token/密码/addr → 回 PairPage', (tester) async {
      SharedPreferences.setMockInitialValues({'connection.addr': addr});
      FlutterSecureStorage.setMockInitialValues({
        'auth.token': 'tok',
        'auth.password': 'pw',
      });
      final fake = FakeRemoteClient();
      await pumpApp(tester, fake);
      expect(find.byType(NavigationBar), findsOneWidget);

      await tester.tap(find.text('设置'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('logout-button')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('确认退出'));
      await tester.pumpAndSettle();

      expect(find.byType(PairPage), findsOneWidget);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString(ConnectionService.addrKey), isNull);
      final svc = ConnectionService();
      expect(await svc.getToken(), isNull);
      expect(await svc.getPassword(), isNull);
    });
  });

  group('LoginPage 记住密码', () {
    testWidgets('已存密码时自动填充并开启开关', (tester) async {
      SharedPreferences.setMockInitialValues({'connection.addr': addr});
      FlutterSecureStorage.setMockInitialValues({'auth.password': 'saved-pw'});
      final fake = FakeRemoteClient();
      await pumpApp(tester, fake);
      expect(find.byType(LoginPage), findsOneWidget);

      expect(find.text('saved-pw'), findsOneWidget);
      final sw = tester.widget<SwitchListTile>(find.byType(SwitchListTile));
      expect(sw.value, isTrue);
    });
  });
}
