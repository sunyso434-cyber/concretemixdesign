// ignore_for_file: file_names
// 文件名 RemoteClient 为任务简报指定的 PascalCase 命名，保持原样。

import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

/// WebSocket 客户端异常。
class RemoteClientException implements Exception {
  RemoteClientException(this.message, {this.authRejected = false});

  final String message;

  /// 认证被服务端拒绝（如 token 失效）。此时不自动重连，
  /// 需要调用方重新登录后再调用 [RemoteClient.connect]。
  final bool authRejected;

  @override
  String toString() => 'RemoteClientException: $message';
}

/// WebSocket 客户端：连接认证 + 消息收发 + 心跳 + 断线重连。
///
/// 线上协议与电脑端 R5/R6 对齐：
/// - 连接 `wss://<域名>/concrete/ws`，握手完成后首帧发
///   `{type:'auth', token}`，收到 `{type:'auth_ok'}` 后才算就绪。
/// - [send] 发出的请求自动携带 `type` 与自增 `requestId`；
///   服务端的响应与推送都通过 [events] 广播流流出（同通道回）。
/// - 每 [heartbeatInterval] 发一次 `{type:'ping'}` 应用层心跳。
/// - 断线后按指数退避重连（[initialBackoff] 起、每次翻倍、封顶
///   [maxBackoff]），重连成功后重新发送 auth。
///
/// 证书：使用正规域名证书，系统自动受信任，不含任何跳过校验逻辑。
class RemoteClient {
  RemoteClient({
    WebSocketChannel Function(String url)? channelFactory,
    Duration heartbeatInterval = const Duration(seconds: 30),
    Duration authTimeout = const Duration(seconds: 15),
    Duration initialBackoff = const Duration(seconds: 1),
    Duration maxBackoff = const Duration(seconds: 30),
  })  : _channelFactory = channelFactory ?? _defaultChannelFactory,
        _heartbeatInterval = heartbeatInterval,
        _authTimeout = authTimeout,
        _initialBackoff = initialBackoff,
        _maxBackoff = maxBackoff;

  /// 默认通道工厂：用标准 [WebSocketChannel.connect] 连接目标地址。
  static WebSocketChannel _defaultChannelFactory(String url) =>
      WebSocketChannel.connect(Uri.parse(url));

  final WebSocketChannel Function(String url) _channelFactory;
  final Duration _heartbeatInterval;
  final Duration _authTimeout;
  final Duration _initialBackoff;
  final Duration _maxBackoff;

  /// 收到的所有 JSON 消息的广播流（含推送与 auth_ok/auth_error）。
  final StreamController<Map<String, dynamic>> _events =
      StreamController<Map<String, dynamic>>.broadcast();

  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _sub;
  Timer? _heartbeatTimer;
  Timer? _reconnectTimer;
  Completer<void>? _authCompleter;
  String _url = '';
  String _token = '';
  bool _connected = false;
  bool _closeRequested = true;
  int _backoffAttempt = 0;
  int _requestSeq = 0;

  /// 所有收到的 JSON 消息（含服务端主动推送）。
  Stream<Map<String, dynamic>> get events => _events.stream;

  /// 是否已认证就绪（收到过 auth_ok）。
  bool get isConnected => _connected;

  /// 建立连接并完成认证。
  ///
  /// 首帧发送 `{type:'auth', token}`，等待服务端 `{type:'auth_ok'}` 才返回。
  /// - 认证被拒绝（auth_error）时抛 [RemoteClientException]，不自动重连；
  /// - 网络层失败（握手失败 / 断开 / 超时）时抛 [RemoteClientException]，
  ///   并在后台按指数退避自动重连，重连成功后重新认证。
  Future<void> connect(String url, String token) async {
    _url = url;
    _token = token;
    _closeRequested = false;
    _backoffAttempt = 0;
    await _openAndAuth();
  }

  Future<void> _openAndAuth() async {
    if (_closeRequested) return;
    _stopReconnectTimer();
    await _teardownChannel();

    final auth = Completer<void>();
    _authCompleter = auth;

    final WebSocketChannel channel;
    try {
      channel = _channelFactory(_url);
    } catch (_) {
      // 工厂创建失败视为连接失败，走退避重连。
      _handleDisconnected();
      return;
    }
    _channel = channel;

    // 握手完成后发送 auth 首帧；握手失败视为连接失败。
    unawaited(channel.ready.then<void>((_) {
      if (_closeRequested) return;
      channel.sink.add(jsonEncode({'type': 'auth', 'token': _token}));
    }).catchError((Object _) {
      _handleDisconnected();
    }));

    _sub = channel.stream.listen(
      _onMessage,
      onError: (Object _) => _handleDisconnected(),
      onDone: () => _handleDisconnected(),
    );

    try {
      await auth.future.timeout(_authTimeout);
    } on TimeoutException {
      _handleDisconnected();
      return;
    } on RemoteClientException catch (e) {
      if (e.authRejected) {
        // 认证被拒绝：不是网络问题，不自动重连。
        _stopHeartbeat();
        _connected = false;
        await _teardownChannel();
        rethrow;
      }
      // 连接过程断线：_handleDisconnected 已安排退避重连。
      return;
    }

    _connected = true;
    _backoffAttempt = 0;
    _startHeartbeat();
  }

  /// 发送一条请求消息，自动携带 `type` 与自增 `requestId`。
  ///
  /// 未就绪时抛 [StateError]，由调用方决定如何提示用户。
  void send(String type, Map<String, dynamic> payload) {
    final channel = _channel;
    if (!_connected || channel == null) {
      throw StateError('RemoteClient 未连接，无法发送 $type 消息');
    }
    final requestId = 'req-${_requestSeq++}';
    channel.sink.add(
      jsonEncode({...payload, 'type': type, 'requestId': requestId}),
    );
  }

  /// 主动关闭连接：停止心跳与重连，关闭底层通道。
  Future<void> close() async {
    _closeRequested = true;
    _stopHeartbeat();
    _stopReconnectTimer();
    _connected = false;
    _failAuthCompleter('客户端已关闭');
    await _teardownChannel();
  }

  void _onMessage(dynamic data) {
    if (data is! String) return;
    final Object? decoded;
    try {
      decoded = jsonDecode(data);
    } catch (_) {
      return; // 非 JSON 消息忽略
    }
    if (decoded is! Map<String, dynamic>) return;

    final type = decoded['type'];
    if (type == 'auth_ok') {
      _authCompleter?.complete();
      _authCompleter = null;
    } else if (type == 'auth_error' ||
        type == 'auth_failed' ||
        type == 'auth_rejected') {
      final c = _authCompleter;
      _authCompleter = null;
      if (c != null && !c.isCompleted) {
        c.completeError(
          RemoteClientException('认证被拒绝', authRejected: true),
        );
      }
    }

    // 所有 JSON 消息（含 auth_ok/auth_error）都广播给监听方。
    _events.add(decoded);
  }

  void _handleDisconnected() {
    if (_closeRequested) return;
    _stopHeartbeat();
    _connected = false;
    unawaited(_teardownChannel());
    _failAuthCompleter('连接断开');
    _scheduleReconnect();
  }

  void _failAuthCompleter(String message) {
    final c = _authCompleter;
    _authCompleter = null;
    if (c != null && !c.isCompleted) {
      c.completeError(RemoteClientException(message));
    }
  }

  void _scheduleReconnect() {
    if (_closeRequested) return;
    // 幂等：断线可能被多个回调触发（握手失败 + stream 报错），只调度一次，
    // 避免 _backoffAttempt 重复累加导致退避跳级（1s→2s→4s 变 1s→4s→16s）。
    if (_reconnectTimer?.isActive ?? false) return;
    final delay = _nextBackoff();
    _backoffAttempt++;
    _reconnectTimer = Timer(delay, () {
      if (_closeRequested) return;
      unawaited(_openAndAuth());
    });
  }

  /// 指数退避：initialBackoff → 翻倍 → … → 封顶 maxBackoff。
  Duration _nextBackoff() {
    var ms = _initialBackoff.inMilliseconds;
    if (_backoffAttempt > 0) {
      final shift = _backoffAttempt;
      ms = shift >= 30
          ? _maxBackoff.inMilliseconds // 防移位溢出
          : _initialBackoff.inMilliseconds << shift;
    }
    if (ms >= _maxBackoff.inMilliseconds) return _maxBackoff;
    return Duration(milliseconds: ms);
  }

  void _startHeartbeat() {
    _stopHeartbeat();
    _heartbeatTimer = Timer.periodic(_heartbeatInterval, (_) {
      final channel = _channel;
      if (_connected && channel != null) {
        channel.sink.add(jsonEncode({'type': 'ping'}));
      }
    });
  }

  void _stopHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
  }

  void _stopReconnectTimer() {
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
  }

  Future<void> _teardownChannel() async {
    final sub = _sub;
    _sub = null;
    await sub?.cancel();
    final channel = _channel;
    _channel = null;
    if (channel != null) {
      try {
        await channel.sink.close();
      } catch (_) {
        // 已断开的连接 close 可能抛错，忽略。
      }
    }
  }
}
