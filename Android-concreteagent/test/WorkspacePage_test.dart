// ignore_for_file: file_names
// 文件名 WorkspacePage_test 为任务简报指定的 PascalCase 命名，保持原样。

import 'dart:async';

import 'package:concrete_agent/pages/WorkspacePage.dart';
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

/// 挂载 WorkspacePage（注入 fake），测试结束后卸载以清理订阅。
Future<void> pumpWorkspace(
  WidgetTester tester,
  FakeRemoteClient fake,
) async {
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox());
  });
  await tester.pumpWidget(
    MaterialApp(
      home: WorkspacePage(client: fake),
    ),
  );
  await tester.pump();
}

/// 让服务端回一个含 proj1/proj2 两个工作区的 listRecent 响应。
Future<void> renderTwoWorkspaces(
  WidgetTester tester,
  FakeRemoteClient fake, {
  bool proj1Current = false,
}) async {
  fake.emit({
    'channel': 'workspace:listRecent',
    'payload': {
      'requestId': 'req-0',
      'success': true,
      'recent': [
        {
          'path': 'C:/ws/proj1',
          'savedAt': '2026-08-01T10:00:00.000Z',
          'isCurrent': proj1Current,
        },
        {
          'path': 'C:/ws/proj2',
          'savedAt': '2026-08-01T09:00:00.000Z',
          'isCurrent': false,
        },
      ],
    },
  });
  await tester.pump();
}

/// 让服务端回 workspace:current 响应（当前工作区 path）。
void emitCurrent(
  FakeRemoteClient fake,
  String? path,
) {
  fake.emit({
    'channel': 'workspace:current',
    'payload': {'requestId': 'req-1', 'success': true, 'path': path},
  });
}

void main() {
  group('WorkspacePage - 工作区列表', () {
    testWidgets('初始已连接自动拉取 listRecent 与 current', (tester) async {
      final fake = FakeRemoteClient();
      await pumpWorkspace(tester, fake);

      expect(fake.sentOf('workspace:listRecent'), hasLength(1));
      expect(fake.sentOf('workspace:current'), hasLength(1));
    });

    testWidgets('listRecent 响应渲染工作区 path', (tester) async {
      final fake = FakeRemoteClient();
      await pumpWorkspace(tester, fake);
      await renderTwoWorkspaces(tester, fake);

      expect(find.text('C:/ws/proj1'), findsOneWidget);
      expect(find.text('C:/ws/proj2'), findsOneWidget);
    });

    testWidgets('空列表显示空态', (tester) async {
      final fake = FakeRemoteClient();
      await pumpWorkspace(tester, fake);

      fake.emit({
        'channel': 'workspace:listRecent',
        'payload': {
          'requestId': 'req-0',
          'success': true,
          'recent': [],
        },
      });
      await tester.pump();

      expect(find.text('暂无工作区'), findsOneWidget);
    });

    testWidgets('listRecent 失败显示错误', (tester) async {
      final fake = FakeRemoteClient();
      await pumpWorkspace(tester, fake);

      fake.emit({
        'channel': 'workspace:listRecent',
        'payload': {
          'requestId': 'req-0',
          'success': false,
          'error': 'SERVER_DOWN',
        },
      });
      await tester.pump();

      expect(find.textContaining('SERVER_DOWN'), findsOneWidget);
    });
  });

  group('WorkspacePage - 当前标识', () {
    testWidgets('workspace:current 响应在列表高亮当前工作区', (tester) async {
      final fake = FakeRemoteClient();
      await pumpWorkspace(tester, fake);
      await renderTwoWorkspaces(tester, fake);

      expect(find.text('当前'), findsNothing);

      emitCurrent(fake, 'C:/ws/proj1');
      await tester.pump();

      expect(find.text('当前'), findsOneWidget);
      // “当前”标识挂在 proj1 那一行上
      final currentTile = find.ancestor(
        of: find.text('当前'),
        matching: find.byType(ListTile),
      );
      expect(
        find.descendant(
          of: currentTile,
          matching: find.text('C:/ws/proj1'),
        ),
        findsOneWidget,
      );
    });

    testWidgets('current 为 null（无工作区）时不高亮任何项', (tester) async {
      final fake = FakeRemoteClient();
      await pumpWorkspace(tester, fake);
      await renderTwoWorkspaces(tester, fake);

      emitCurrent(fake, null);
      await tester.pump();

      expect(find.text('当前'), findsNothing);
    });

    testWidgets('listRecent 自带 isCurrent 也能高亮', (tester) async {
      final fake = FakeRemoteClient();
      await pumpWorkspace(tester, fake);
      await renderTwoWorkspaces(tester, fake, proj1Current: true);

      expect(find.text('当前'), findsOneWidget);
    });
  });

  group('WorkspacePage - 切换', () {
    testWidgets('点击工作区发送 workspace:open', (tester) async {
      final fake = FakeRemoteClient();
      await pumpWorkspace(tester, fake);
      await renderTwoWorkspaces(tester, fake);

      await tester.tap(find.text('C:/ws/proj2'));
      await tester.pump();

      final opens = fake.sentOf('workspace:open');
      expect(opens, hasLength(1));
      expect(opens.first['path'], 'C:/ws/proj2');
    });

    testWidgets('open 响应成功刷新列表与当前', (tester) async {
      final fake = FakeRemoteClient();
      await pumpWorkspace(tester, fake);
      await renderTwoWorkspaces(tester, fake);

      expect(fake.sentOf('workspace:listRecent'), hasLength(1));
      expect(fake.sentOf('workspace:current'), hasLength(1));

      await tester.tap(find.text('C:/ws/proj2'));
      await tester.pump();

      fake.emit({
        'channel': 'workspace:open',
        'payload': {
          'requestId': 'req-2',
          'success': true,
          'path': 'C:/ws/proj2',
        },
      });
      await tester.pump();

      // 成功后重新拉取列表与当前，保持双向同步
      expect(fake.sentOf('workspace:listRecent'), hasLength(2));
      expect(fake.sentOf('workspace:current'), hasLength(2));
    });
  });

  group('WorkspacePage - workspace:changed 双向同步', () {
    testWidgets('收到 workspace:changed 刷新当前与列表', (tester) async {
      final fake = FakeRemoteClient();
      await pumpWorkspace(tester, fake);
      await renderTwoWorkspaces(tester, fake);

      expect(fake.sentOf('workspace:listRecent'), hasLength(1));
      expect(fake.sentOf('workspace:current'), hasLength(1));

      fake.emit({
        'channel': 'workspace:changed',
        'payload': {'path': 'C:/ws/proj2'},
      });
      await tester.pump();

      expect(fake.sentOf('workspace:listRecent'), hasLength(2));
      expect(fake.sentOf('workspace:current'), hasLength(2));

      // 推送 path 立即作为当前标识，无需等响应
      expect(find.text('当前'), findsOneWidget);
      final currentTile = find.ancestor(
        of: find.text('当前'),
        matching: find.byType(ListTile),
      );
      expect(
        find.descendant(
          of: currentTile,
          matching: find.text('C:/ws/proj2'),
        ),
        findsOneWidget,
      );
    });
  });
}
