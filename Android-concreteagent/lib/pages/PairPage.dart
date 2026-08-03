// ignore_for_file: file_names
// 文件名 PairPage 为任务简报指定的 PascalCase 命名，保持原样。

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../services/ConnectionService.dart';

/// 扫码区域构建器。
///
/// 生产用真实 mobile_scanner 摄像头；测试注入 fake（如按钮）模拟扫码结果，
/// 避免 widget 测试触碰相机平台通道。
typedef ScannerBuilder = Widget Function(
  BuildContext context,
  void Function(String rawData) onDetect,
);

/// 扫码配对页：扫电脑端二维码 → [ConnectionService.pair] → 跳登录。
///
/// 二维码格式（与电脑端 R10 统一）：
/// `{"addr":"wss://<域名>/concrete/ws","code":"<8位>"}`
///
/// 配对成功后 [onPaired] 通知 App 层切换到登录页（本页随后被卸载）。
class PairPage extends StatefulWidget {
  const PairPage({
    super.key,
    this.connectionService,
    this.scannerBuilder,
    this.onPaired,
  });

  /// 连接配置服务（生产为 null 时自动创建；测试可注入）。
  final ConnectionService? connectionService;

  /// 扫码区域构建器。null 时用真实 mobile_scanner 摄像头。
  final ScannerBuilder? scannerBuilder;

  /// 配对成功回调（App 层切换到登录页）。
  final VoidCallback? onPaired;

  @override
  State<PairPage> createState() => _PairPageState();
}

class _PairPageState extends State<PairPage> {
  MobileScannerController? _controller;
  String? _error;
  bool _pairing = false; // 防扫码回调连续触发重复配对
  bool _scanning = false; // 是否已点击开始扫码（控制摄像头开启）

  ConnectionService get _svc => widget.connectionService ?? ConnectionService();

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  /// 点击「开始扫码」按钮后开启摄像头。
  void _startScan() {
    setState(() {
      _scanning = true;
      _error = null;
    });
  }

  Future<void> _onDetect(String raw) async {
    if (_pairing) return;
    _pairing = true;
    final result = await _svc.pair(raw);
    if (!mounted) return;
    if (!result.ok) {
      setState(() {
        _error = _pairErrorText(result.error);
        _pairing = false; // 失败可重扫
      });
      // 失败后停止摄像头，回到初始「点击扫码」状态
      _controller?.dispose();
      _controller = null;
      if (mounted) setState(() => _scanning = false);
      return;
    }
    // 配对成功：addr 已保存，通知 App 进入登录页。
    widget.onPaired?.call();
  }

  Widget _buildScanner() {
    final builder = widget.scannerBuilder;
    if (builder != null) {
      // 测试注入分支：仍按原逻辑直接构建。
      return builder(context, _onDetect);
    }

    // 未点击扫码时：显示白色占位 + 中心方框引导。
    if (!_scanning) {
      return _buildIdlePlaceholder();
    }

    // 已点击扫码：开启摄像头，裁剪到中心方框内显示。
    _controller ??= MobileScannerController();
    return Center(
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: SizedBox(
          width: 240,
          height: 240,
          child: MobileScanner(
            controller: _controller,
            onDetect: (capture) {
              final raw = capture.barcodes.isEmpty
                  ? null
                  : capture.barcodes.first.rawValue;
              if (raw != null && raw.isNotEmpty) _onDetect(raw);
            },
          ),
        ),
      ),
    );
  }

  /// 未扫码时的占位：白色背景 + 中心方框引导。
  Widget _buildIdlePlaceholder() {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      color: Colors.white,
      alignment: Alignment.center,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 240,
            height: 240,
            decoration: BoxDecoration(
              border: Border.all(color: scheme.primary, width: 2),
              borderRadius: BorderRadius.circular(16),
            ),
          ),
          const SizedBox(height: 24),
          FilledButton.icon(
            onPressed: _startScan,
            icon: const Icon(Icons.qr_code_scanner),
            label: const Text('开始扫码'),
          ),
        ],
      ),
    );
  }

  String _pairErrorText(String? error) {
    switch (error) {
      case 'INVALID_JSON':
        return '二维码格式错误，请扫描电脑端「远程连接」的二维码';
      case 'MISSING_ADDR':
        return '二维码缺少服务器地址';
      case 'INVALID_CODE':
        return '配对码无效（需 8 位字母数字）';
      case 'INVALID_ADDR':
        return '服务器地址无效，请确认二维码来自砼智电脑端';
      default:
        return '配对失败：${error ?? '未知错误'}';
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('扫码配对')),
      body: Column(
        children: [
          Expanded(child: _buildScanner()),
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 16, 24, 8),
            child: Text(
              '请扫描电脑端「远程连接」面板显示的二维码完成配对',
              textAlign: TextAlign.center,
              style: TextStyle(color: scheme.onSurfaceVariant),
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: Text(
                _error!,
                textAlign: TextAlign.center,
                style: TextStyle(color: scheme.error),
              ),
            ),
          const SizedBox(height: 16),
        ],
      ),
    );
  }
}
