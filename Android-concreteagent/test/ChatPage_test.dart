// ignore_for_file: file_names
// 文件名 ChatPage_test 为任务简报指定的 PascalCase 命名，保持原样。

import 'dart:async';

import 'package:concrete_agent/pages/ChatPage.dart';
import 'package:concrete_agent/services/RemoteClient.dart';
import 'package:concrete_agent/widgets/MessageBubble.dart';
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

  void setConnected(bool value) => _connected = value;

  void emit(Map<String, dynamic> message) => _events.add(message);

  /// 收集发出的指定类型请求。
  List<Map<String, dynamic>> sentOf(String type) =>
      sent.where((s) => s.$1 == type).map((s) => s.$2).toList();
}

/// 挂载 ChatPage（注入 fake），并确保测试结束后卸载以清理轮询 Timer。
Future<void> pumpChat(WidgetTester tester, FakeRemoteClient fake) async {
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox());
  });
  await tester.pumpWidget(
    MaterialApp(home: ChatPage(sessionId: 's1', client: fake)),
  );
  await tester.pump();
}

void main() {
  group('ChatPage - 消息渲染与发送', () {
    testWidgets('发送消息：渲染用户气泡 + AI 占位，发出 agent:run', (tester) async {
      final fake = FakeRemoteClient();
      await pumpChat(tester, fake);

      await tester.enterText(find.byType(TextField), '设计一个C30配比');
      await tester.tap(find.byIcon(Icons.send));
      await tester.pump();

      // 用户气泡渲染
      expect(find.text('设计一个C30配比'), findsOneWidget);
      // 两条消息（用户 + AI 流式占位）
      expect(find.byType(MessageBubble), findsNWidgets(2));
      // 发出 agent:run，带 sessionId 与 message
      final runs = fake.sentOf('agent:run');
      expect(runs, hasLength(1));
      expect(runs.first['sessionId'], 's1');
      expect(runs.first['message'], '设计一个C30配比');
    });

    testWidgets('空白消息不发送', (tester) async {
      final fake = FakeRemoteClient();
      await pumpChat(tester, fake);

      await tester.enterText(find.byType(TextField), '   ');
      await tester.tap(find.byIcon(Icons.send));
      await tester.pump();

      expect(fake.sentOf('agent:run'), isEmpty);
      expect(find.byType(MessageBubble), findsNothing);
    });
  });

  group('ChatPage - 流式输出', () {
    testWidgets('agent:progress text_delta 增量追加到 AI 气泡', (tester) async {
      final fake = FakeRemoteClient();
      await pumpChat(tester, fake);

      await tester.enterText(find.byType(TextField), '设计一个C30配比');
      await tester.tap(find.byIcon(Icons.send));
      await tester.pump();

      fake.emit({
        'channel': 'agent:progress',
        'payload': {'type': 'text_delta', 'content': '水泥 ', 'sessionId': 's1'},
      });
      await tester.pump();
      fake.emit({
        'channel': 'agent:progress',
        'payload': {'type': 'text_delta', 'content': '500kg', 'sessionId': 's1'},
      });
      await tester.pump();

      expect(find.textContaining('水泥 500kg'), findsOneWidget);
    });

    testWidgets('done 结束流式，result.reply 填充空气泡', (tester) async {
      final fake = FakeRemoteClient();
      await pumpChat(tester, fake);

      await tester.enterText(find.byType(TextField), '你好');
      await tester.tap(find.byIcon(Icons.send));
      await tester.pump();

      fake.emit({
        'channel': 'agent:progress',
        'payload': {
          'type': 'done',
          'result': {'reply': '我是助手'},
          'sessionId': 's1',
        },
      });
      await tester.pump();

      expect(find.text('我是助手'), findsOneWidget);
      // 流式结束，不再显示光标
      expect(find.textContaining('▍'), findsNothing);
    });

    testWidgets('error 事件显示错误提示', (tester) async {
      final fake = FakeRemoteClient();
      await pumpChat(tester, fake);

      await tester.enterText(find.byType(TextField), '你好');
      await tester.tap(find.byIcon(Icons.send));
      await tester.pump();

      fake.emit({
        'channel': 'agent:progress',
        'payload': {'type': 'error', 'error': '模型熔断', 'sessionId': 's1'},
      });
      await tester.pump();

      expect(find.textContaining('模型熔断'), findsOneWidget);
    });

    testWidgets('agent:run 同通道响应失败显示错误', (tester) async {
      final fake = FakeRemoteClient();
      await pumpChat(tester, fake);

      await tester.enterText(find.byType(TextField), '你好');
      await tester.tap(find.byIcon(Icons.send));
      await tester.pump();

      fake.emit({
        'channel': 'agent:run',
        'payload': {
          'requestId': 'req-0',
          'success': false,
          'error': 'EXECUTOR_NOT_READY',
        },
      });
      await tester.pump();

      expect(find.textContaining('EXECUTOR_NOT_READY'), findsOneWidget);
    });
  });

  group('ChatPage - 确认弹窗', () {
    testWidgets('confirmation-request → 弹窗 → 选择选项发 agent:confirm', (tester) async {
      final fake = FakeRemoteClient();
      await pumpChat(tester, fake);

      fake.emit({
        'channel': 'agent:confirmation-request',
        'payload': {
          'sessionId': 's1',
          'question': '确定继续吗？',
          'inputType': 'choice',
          'options': ['执行', '跳过'],
        },
      });
      await tester.pumpAndSettle();

      expect(find.text('确定继续吗？'), findsOneWidget);

      await tester.tap(find.text('执行'));
      await tester.pumpAndSettle();

      final confirms = fake.sentOf('agent:confirm');
      expect(confirms, hasLength(1));
      expect(confirms.first['sessionId'], 's1');
      expect(confirms.first['confirmed'], isTrue);
      expect(confirms.first['args'], {'answer': '执行'});
    });

    testWidgets('取消确认发 agent:confirm confirmed=false', (tester) async {
      final fake = FakeRemoteClient();
      await pumpChat(tester, fake);

      fake.emit({
        'channel': 'agent:confirmation-request',
        'payload': {
          'sessionId': 's1',
          'question': '是否继续？',
          'inputType': 'text',
          'placeholder': '补充说明',
        },
      });
      await tester.pumpAndSettle();

      expect(find.text('是否继续？'), findsOneWidget);

      await tester.tap(find.text('取消'));
      await tester.pumpAndSettle();

      final confirms = fake.sentOf('agent:confirm');
      expect(confirms, hasLength(1));
      expect(confirms.first['confirmed'], isFalse);
    });

    testWidgets('text 模式输入答案并确认', (tester) async {
      final fake = FakeRemoteClient();
      await pumpChat(tester, fake);

      fake.emit({
        'channel': 'agent:confirmation-request',
        'payload': {
          'sessionId': 's1',
          'question': '请输入楼栋号',
          'inputType': 'text',
        },
      });
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField).last, '3号楼');
      await tester.tap(find.text('确认'));
      await tester.pumpAndSettle();

      final confirms = fake.sentOf('agent:confirm');
      expect(confirms, hasLength(1));
      expect(confirms.first['confirmed'], isTrue);
      expect(confirms.first['args'], {'answer': '3号楼'});
    });
  });

  group('ChatPage - Todo 面板', () {
    testWidgets('todo:updated 更新面板', (tester) async {
      final fake = FakeRemoteClient();
      await pumpChat(tester, fake);

      fake.emit({
        'channel': 'todo:updated',
        'payload': {
          'sessionId': 's1',
          'todos': [
            {'id': '1', 'content': '设计配比', 'priority': 'high', 'status': 'pending'},
            {'id': '2', 'content': '试配验证', 'priority': 'low', 'status': 'completed'},
          ],
          'total': 2,
          'completed': 1,
        },
      });
      await tester.pumpAndSettle();

      expect(find.text('设计配比'), findsOneWidget);
      expect(find.text('试配验证'), findsOneWidget);
      expect(find.text('1/2'), findsOneWidget);
    });

    testWidgets('todo:list 响应填充面板', (tester) async {
      final fake = FakeRemoteClient();
      await pumpChat(tester, fake);

      fake.emit({
        'channel': 'todo:list',
        'payload': {
          'requestId': 'req-0',
          'success': true,
          'todos': [
            {'id': '1', 'content': '统计强度', 'priority': 'medium', 'status': 'in_progress'},
          ],
          'total': 1,
          'completed': 0,
        },
      });
      await tester.pumpAndSettle();

      expect(find.text('统计强度'), findsOneWidget);
    });
  });

  group('ChatPage - 断线重连', () {
    testWidgets('初始未连接不发 todo:list，auth_ok 后拉取重同步', (tester) async {
      final fake = FakeRemoteClient(connected: false);
      await pumpChat(tester, fake);

      expect(fake.sentOf('todo:list'), isEmpty);
      expect(find.text('连接中…'), findsOneWidget);

      fake.emit({'type': 'auth_ok'});
      await tester.pumpAndSettle();

      expect(fake.sentOf('todo:list'), hasLength(1));
      expect(fake.sentOf('todo:list').first['sessionId'], 's1');
      expect(find.text('已连接'), findsOneWidget);
    });

    testWidgets('注入已连接客户端时自动拉一次 todo:list', (tester) async {
      final fake = FakeRemoteClient();
      await pumpChat(tester, fake);

      final lists = fake.sentOf('todo:list');
      expect(lists, hasLength(1));
      expect(lists.first['sessionId'], 's1');
    });
  });
}
