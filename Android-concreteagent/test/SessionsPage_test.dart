// ignore_for_file: file_names
// 文件名 SessionsPage_test 为任务简报指定的 PascalCase 命名，保持原样。

import 'dart:async';

import 'package:concrete_agent/pages/ChatPage.dart';
import 'package:concrete_agent/pages/SessionsPage.dart';
import 'package:concrete_agent/services/RemoteClient.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// 测试用 RemoteClient 替身：记录发送、可注入服务端事件。
///
/// 手机端收到的服务端业务消息统一为电脑端 FanoutSink 的
/// `{ channel, payload }` 格式（wrapWs 序列化）；auth_ok 为 `{ type }` 格式。
class FakeRemoteClient implements RemoteClient {
  FakeRemoteClient({bool connected = true}) : _connected = connected;

  final List<(String, Map<String, dynamic>)> sent = [];
  final StreamController<Map<String, dynamic>> _events =
      StreamController<Map<String, dynamic>>.broadcast();
  bool _connected;

  @override
  Stream<Map<String, dynamic>> get events => _events.stream;

  @override
  bool get isConnected => _connected;

  @override
  Future<void> connect(String url, String token) async {
    _connected = true;
  }

  @override
  void send(String type, Map<String, dynamic> payload) {
    sent.add((type, Map.of(payload)));
  }

  @override
  Future<void> close() async {}

  void emit(Map<String, dynamic> message) => _events.add(message);

  /// 收集发出的指定类型请求。
  List<Map<String, dynamic>> sentOf(String type) =>
      sent.where((s) => s.$1 == type).map((s) => s.$2).toList();
}

/// 挂载 SessionsPage（注入 fake），测试结束后卸载以清理订阅。
Future<void> pumpSessions(
  WidgetTester tester,
  FakeRemoteClient fake, {
  String Function()? sessionIdFactory,
}) async {
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox());
  });
  await tester.pumpWidget(
    MaterialApp(
      home: SessionsPage(
        client: fake,
        sessionIdFactory: sessionIdFactory,
      ),
    ),
  );
  await tester.pump();
}

/// 让服务端回一个含 s1 会话的列表响应。
Future<void> renderOneSession(
  WidgetTester tester,
  FakeRemoteClient fake,
) async {
  fake.emit({
    'channel': 'agent:listSessions',
    'payload': {
      'requestId': 'req-0',
      'success': true,
      'sessions': [
        {
          'sessionId': 's1',
          'sessionName': 'C30配比设计',
          'lastActivity': '2026-08-01T10:30:00.000Z',
        },
      ],
    },
  });
  await tester.pump();
}

void main() {
  group('SessionsPage - 会话列表', () {
    testWidgets('初始已连接自动拉取 agent:listSessions', (tester) async {
      final fake = FakeRemoteClient();
      await pumpSessions(tester, fake);

      final lists = fake.sentOf('agent:listSessions');
      expect(lists, hasLength(1));
      expect(lists.first, isEmpty);
    });

    testWidgets('listSessions 响应渲染会话标题与兜底标题', (tester) async {
      final fake = FakeRemoteClient();
      await pumpSessions(tester, fake);

      fake.emit({
        'channel': 'agent:listSessions',
        'payload': {
          'requestId': 'req-0',
          'success': true,
          'sessions': [
            {
              'sessionId': 's1',
              'sessionName': 'C30配比设计',
              'lastActivity': '2026-08-01T02:30:00.000Z',
            },
            {
              'sessionId': 's2',
              'sessionName': null,
              'lastActivity': '2026-08-01T01:00:00.000Z',
            },
          ],
        },
      });
      await tester.pump();

      expect(find.text('C30配比设计'), findsOneWidget);
      expect(find.text('新对话'), findsOneWidget); // 无标题兜底
    });

    testWidgets('listSessions 失败显示错误', (tester) async {
      final fake = FakeRemoteClient();
      await pumpSessions(tester, fake);

      fake.emit({
        'channel': 'agent:listSessions',
        'payload': {
          'requestId': 'req-0',
          'success': false,
          'error': 'SERVER_DOWN',
        },
      });
      await tester.pump();

      expect(find.textContaining('SERVER_DOWN'), findsOneWidget);
    });

    testWidgets('无会话显示空态', (tester) async {
      final fake = FakeRemoteClient();
      await pumpSessions(tester, fake);

      fake.emit({
        'channel': 'agent:listSessions',
        'payload': {'requestId': 'req-0', 'success': true, 'sessions': []},
      });
      await tester.pump();

      expect(find.text('暂无会话'), findsOneWidget);
    });
  });

  group('SessionsPage - 续聊', () {
    testWidgets('点击会话进入 ChatPage 并传入 sessionId', (tester) async {
      final fake = FakeRemoteClient();
      await pumpSessions(tester, fake);
      await renderOneSession(tester, fake);

      await tester.tap(find.text('C30配比设计'));
      await tester.pumpAndSettle();

      final chat = tester.widget<ChatPage>(find.byType(ChatPage));
      expect(chat.sessionId, 's1');
    });
  });

  group('SessionsPage - 新建', () {
    testWidgets('点击新建进入空 ChatPage 并传入新 sessionId', (tester) async {
      final fake = FakeRemoteClient();
      await pumpSessions(tester, fake, sessionIdFactory: () => 'new-1');

      await tester.tap(find.byIcon(Icons.add));
      await tester.pumpAndSettle();

      final chat = tester.widget<ChatPage>(find.byType(ChatPage));
      expect(chat.sessionId, 'new-1');
    });
  });

  group('SessionsPage - 删除/归档', () {
    testWidgets('长按删除：确认后发 agent:deleteSession 并移除', (tester) async {
      final fake = FakeRemoteClient();
      await pumpSessions(tester, fake);
      await renderOneSession(tester, fake);

      await tester.longPress(find.text('C30配比设计'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('删除'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('确定删除'));
      await tester.pumpAndSettle();

      final deletes = fake.sentOf('agent:deleteSession');
      expect(deletes, hasLength(1));
      expect(deletes.first['sessionId'], 's1');
      expect(find.text('C30配比设计'), findsNothing);
    });

    testWidgets('长按归档：发 agent:archiveSession', (tester) async {
      final fake = FakeRemoteClient();
      await pumpSessions(tester, fake);
      await renderOneSession(tester, fake);

      await tester.longPress(find.text('C30配比设计'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('归档'));
      await tester.pumpAndSettle();

      final archives = fake.sentOf('agent:archiveSession');
      expect(archives, hasLength(1));
      expect(archives.first['sessionIds'], ['s1']);
      expect(archives.first['archived'], isTrue);
    });
  });

  group('SessionsPage - sessionUpdated 刷新', () {
    testWidgets('收到 agent:sessionUpdated 重新拉取列表', (tester) async {
      final fake = FakeRemoteClient();
      await pumpSessions(tester, fake);

      expect(fake.sentOf('agent:listSessions'), hasLength(1));

      fake.emit({
        'channel': 'agent:sessionUpdated',
        'payload': {'sessionId': 's1', 'sessionName': '新标题'},
      });
      await tester.pump();

      expect(fake.sentOf('agent:listSessions'), hasLength(2));
    });
  });
}
