// ignore_for_file: file_names
// 文件名 RemoteClient_test 为任务简报指定的 PascalCase 命名，保持原样。

import 'dart:async';
import 'dart:convert';

import 'package:concrete_agent/services/RemoteClient.dart';
import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

/// 记录客户端发出数据的 fake sink。
class _FakeWebSocketSink implements WebSocketSink {
  _FakeWebSocketSink(this._inner, {this.onClose});

  final StreamSink<dynamic> _inner;
  final void Function()? onClose;

  @override
  void add(dynamic event) => _inner.add(event);

  @override
  void addError(Object error, [StackTrace? stackTrace]) =>
      _inner.addError(error, stackTrace);

  @override
  Future addStream(Stream<dynamic> stream) => _inner.addStream(stream);

  @override
  Future close([int? closeCode, String? closeReason]) {
    onClose?.call();
    return _inner.close();
  }

  @override
  Future get done => _inner.done;
}

/// 可控的 WebSocketChannel 测试替身。
///
/// - [serverSend]：模拟服务端推送一条 JSON 消息
/// - [serverClose]：模拟服务端断开连接
/// - [sent]：收集客户端发出的所有消息（原始字符串）
class FakeWebSocketChannel implements WebSocketChannel {
  FakeWebSocketChannel() {
    outgoing.stream.listen(sent.add);
  }

  /// 服务端 → 客户端 的流。
  final StreamController<dynamic> incoming =
      StreamController<dynamic>.broadcast();

  /// 客户端 → 服务端 的流，用于收集 [sent]。
  final StreamController<dynamic> outgoing =
      StreamController<dynamic>.broadcast();

  final List<dynamic> sent = [];
  bool manuallyClosed = false;

  late final WebSocketSink _sink =
      _FakeWebSocketSink(outgoing.sink, onClose: () => manuallyClosed = true);

  @override
  Stream get stream => incoming.stream;

  @override
  WebSocketSink get sink => _sink;

  @override
  Future<void> get ready => Future<void>.value();

  @override
  String? get protocol => null;

  @override
  int? get closeCode => null;

  @override
  String? get closeReason => null;

  /// 模拟通道关闭（WebSocketChannel 接口本身没有 close，关闭走 sink）。
  Future<void> close([int? code, String? reason]) async {
    manuallyClosed = true;
    if (!incoming.isClosed) await incoming.close();
    if (!outgoing.isClosed) await outgoing.close();
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  // ---------- 测试辅助 ----------

  void serverSend(Map<String, dynamic> message) =>
      incoming.add(jsonEncode(message));

  void serverClose() => incoming.close();
}

/// 记录每次连接的工厂。
class FakeChannelFactory {
  final List<FakeWebSocketChannel> channels = [];
  final List<String> urls = [];

  WebSocketChannel create(String url) {
    urls.add(url);
    final channel = FakeWebSocketChannel();
    channels.add(channel);
    return channel;
  }
}

/// 建立一条已认证就绪的连接，返回 (client, channel)。
Future<(RemoteClient, FakeWebSocketChannel)> connectClient(
  FakeChannelFactory factory,
) async {
  final client = RemoteClient(
    channelFactory: factory.create,
    heartbeatInterval: const Duration(minutes: 5),
  );
  final connectFuture = client.connect(
    'wss://www.concreteagent.cloud/concrete/ws',
    'tok-1',
  );
  await pumpEventQueue();
  final channel = factory.channels.first;
  channel.serverSend({'type': 'auth_ok'});
  await connectFuture;
  return (client, channel);
}

void main() {
  const url = 'wss://www.concreteagent.cloud/concrete/ws';
  const token = 'tok-1';

  group('RemoteClient.connect - 连接认证', () {
    test('首帧发送 auth 携带 token，收到 auth_ok 后才算就绪', () async {
      final factory = FakeChannelFactory();
      final client = RemoteClient(channelFactory: factory.create);

      final connectFuture = client.connect(url, token);
      await pumpEventQueue();

      expect(factory.channels, hasLength(1));
      expect(factory.urls.single, url);

      final channel = factory.channels.first;
      expect(channel.sent, hasLength(1));
      final auth =
          jsonDecode(channel.sent.first as String) as Map<String, dynamic>;
      expect(auth['type'], 'auth');
      expect(auth['token'], token);

      // 尚未收到 auth_ok，不算就绪
      expect(client.isConnected, isFalse);

      channel.serverSend({'type': 'auth_ok'});
      await connectFuture;
      expect(client.isConnected, isTrue);

      await client.close();
    });

    test('auth_error 被拒绝时 connect 抛 RemoteClientException 且不重连', () async {
      final factory = FakeChannelFactory();
      final client = RemoteClient(channelFactory: factory.create);

      final connectFuture = client.connect(url, token);
      await pumpEventQueue();
      final channel = factory.channels.first;
      channel.serverSend({'type': 'auth_error'});

      await expectLater(connectFuture, throwsA(isA<RemoteClientException>()));
      expect(client.isConnected, isFalse);

      // 认证被拒不自动重连：稍等后仍只有 1 个连接
      await Future<void>.delayed(const Duration(milliseconds: 60));
      expect(factory.channels, hasLength(1));

      await client.close();
    });
  });

  group('RemoteClient.send - 消息发送', () {
    test('send 自动带上 type 与自增 requestId', () async {
      final factory = FakeChannelFactory();
      final (client, channel) = await connectClient(factory);

      client.send('agent:run', {'sessionId': 's1', 'message': '你好'});
      client.send('todo:list', {});

      // broadcast 流事件投递是异步的，等微任务跑完再断言
      await pumpEventQueue();

      final msgs = channel.sent
          .skip(1) // 跳过 auth 首帧
          .map((m) => jsonDecode(m as String) as Map<String, dynamic>)
          .toList();

      expect(msgs, hasLength(2));
      expect(msgs[0]['type'], 'agent:run');
      expect(msgs[0]['requestId'], 'req-0');
      expect(msgs[0]['sessionId'], 's1');
      expect(msgs[0]['message'], '你好');
      expect(msgs[1]['type'], 'todo:list');
      expect(msgs[1]['requestId'], 'req-1');

      await client.close();
    });

    test('未连接时 send 抛出 StateError', () {
      final factory = FakeChannelFactory();
      final client = RemoteClient(channelFactory: factory.create);

      expect(() => client.send('agent:run', {}), throwsStateError);
    });
  });

  group('RemoteClient.events - 推送', () {
    test('events 广播服务端推送消息', () async {
      final factory = FakeChannelFactory();
      final (client, channel) = await connectClient(factory);

      final received = <Map<String, dynamic>>[];
      final sub = client.events.listen(received.add);

      channel.serverSend({'type': 'agent:progress', 'stage': '思考', 'pct': 0.5});
      channel.serverSend({'type': 'todo:updated', 'done': 1});

      await pumpEventQueue();

      expect(received, hasLength(2));
      expect(received[0]['type'], 'agent:progress');
      expect(received[0]['stage'], '思考');
      expect(received[1]['type'], 'todo:updated');

      await sub.cancel();
      await client.close();
    });
  });

  group('RemoteClient - 心跳', () {
    test('每 heartbeatInterval 发送一次 ping 心跳', () async {
      final factory = FakeChannelFactory();
      final client = RemoteClient(
        channelFactory: factory.create,
        heartbeatInterval: const Duration(milliseconds: 50),
      );

      final connectFuture = client.connect(url, token);
      await pumpEventQueue();
      final channel = factory.channels.first;
      channel.serverSend({'type': 'auth_ok'});
      await connectFuture;

      channel.sent.clear();
      await Future<void>.delayed(const Duration(milliseconds: 120));

      final pings = channel.sent
          .where((m) =>
              (jsonDecode(m as String) as Map<String, dynamic>)['type'] ==
              'ping')
          .length;
      expect(pings, greaterThanOrEqualTo(1));

      await client.close();
    });
  });

  group('RemoteClient - 断线重连', () {
    test('断线后按退避重连并重发 auth', () async {
      final factory = FakeChannelFactory();
      final client = RemoteClient(
        channelFactory: factory.create,
        initialBackoff: const Duration(milliseconds: 20),
        maxBackoff: const Duration(milliseconds: 20),
      );

      final connectFuture = client.connect(url, token);
      await pumpEventQueue();
      final ch1 = factory.channels.first;
      ch1.serverSend({'type': 'auth_ok'});
      await connectFuture;
      expect(client.isConnected, isTrue);

      // 服务端断开
      ch1.serverClose();
      await pumpEventQueue();
      expect(client.isConnected, isFalse);

      // 等退避过后应创建第二个连接并重发 auth
      await Future<void>.delayed(const Duration(milliseconds: 60));
      expect(factory.channels, hasLength(2));

      final ch2 = factory.channels[1];
      expect(ch2.sent, hasLength(1));
      final auth =
          jsonDecode(ch2.sent.first as String) as Map<String, dynamic>;
      expect(auth['type'], 'auth');
      expect(auth['token'], token);

      ch2.serverSend({'type': 'auth_ok'});
      await pumpEventQueue();
      expect(client.isConnected, isTrue);

      await client.close();
    });

    test('断线重连按 1s→2s→4s 指数退避（fakeAsync）', () {
      fakeAsync((async) {
        final factory = FakeChannelFactory();
        final client = RemoteClient(channelFactory: factory.create);

        unawaited(client.connect(url, token));
        async.flushMicrotasks();
        final ch1 = factory.channels.first;
        ch1.serverSend({'type': 'auth_ok'});
        async.flushMicrotasks();
        expect(client.isConnected, isTrue);

        // 第一次断线：1s 后重连
        ch1.serverClose();
        async.flushMicrotasks();
        expect(client.isConnected, isFalse);

        async.elapse(const Duration(seconds: 1));
        async.flushMicrotasks();
        expect(factory.channels, hasLength(2));

        // 第二次连接尚未认证成功即断开（连续失败），退避应翻倍到 2s
        final ch2 = factory.channels[1];
        ch2.serverClose();
        async.flushMicrotasks();

        async.elapse(const Duration(seconds: 1));
        async.flushMicrotasks();
        expect(factory.channels, hasLength(2), reason: '1s 时第二次尚未重连');

        async.elapse(const Duration(seconds: 1));
        async.flushMicrotasks();
        expect(factory.channels, hasLength(3), reason: '2s 时第二次重连完成');

        // 清理，避免 pending timer
        client.close();
        async.flushMicrotasks();
      });
    });

    test('close 关闭底层通道且不再重连', () async {
      final factory = FakeChannelFactory();
      final (client, channel) = await connectClient(factory);

      // 服务端断开与主动 close 同时发生
      channel.serverClose();
      await client.close();
      await pumpEventQueue();

      expect(client.isConnected, isFalse);
      expect(channel.manuallyClosed, isTrue);

      // close 后不会触发任何重连
      await Future<void>.delayed(const Duration(milliseconds: 60));
      expect(factory.channels, hasLength(1));
    });
  });
}
