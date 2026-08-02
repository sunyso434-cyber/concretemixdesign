// ignore_for_file: file_names
// 文件名 ConfirmationDialog 为任务简报指定的 PascalCase 命名，保持原样。

import 'package:flutter/material.dart';

/// 确认请求数据模型（与电脑端 agent:confirmation-request payload 对齐）。
class ConfirmationRequest {
  const ConfirmationRequest({
    required this.sessionId,
    required this.question,
    this.inputType = 'text',
    this.options = const [],
    this.placeholder,
    this.defaultValue,
    this.toolName,
  });

  factory ConfirmationRequest.fromJson(Map<String, dynamic> json) {
    final options = json['options'];
    return ConfirmationRequest(
      sessionId: (json['sessionId'] as String?) ?? '',
      question: (json['question'] as String?) ?? '需要你的确认',
      inputType: (json['inputType'] as String?) ?? 'text',
      options: options is List ? options.whereType<String>().toList() : const [],
      placeholder: json['placeholder'] as String?,
      defaultValue: json['defaultValue'] as String?,
      toolName: json['toolName'] as String?,
    );
  }

  final String sessionId;
  final String question;

  /// 'text' 自由文本 / 'choice' 选项选择。
  final String inputType;

  /// inputType='choice' 时的选项。
  final List<String> options;

  /// inputType='text' 时的输入框占位。
  final String? placeholder;

  /// 用户跳过时的默认值。
  final String? defaultValue;

  /// 工具名（用于弹窗标题展示）。
  final String? toolName;

  bool get isChoice => inputType == 'choice';
}

/// 弹出确认弹窗，用户回答后返回答案字符串；取消返回 null。
Future<String?> showConfirmationDialog(
  BuildContext context,
  ConfirmationRequest req,
) {
  return showDialog<String>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _ConfirmationDialog(req: req),
  );
}

class _ConfirmationDialog extends StatefulWidget {
  const _ConfirmationDialog({required this.req});

  final ConfirmationRequest req;

  @override
  State<_ConfirmationDialog> createState() => _ConfirmationDialogState();
}

class _ConfirmationDialogState extends State<_ConfirmationDialog> {
  late final TextEditingController _ctrl =
      TextEditingController(text: widget.req.defaultValue ?? '');

  /// choice 模式当前选中项。
  String? _selected;

  void _finish([String? answer]) {
    Navigator.of(context).pop(answer ?? _ctrl.text.trim());
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final req = widget.req;
    return AlertDialog(
      title: Text(req.toolName == null ? '等待确认' : '工具确认：${req.toolName}'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(req.question),
          const SizedBox(height: 12),
          if (req.isChoice)
            ...req.options.map(
              (opt) => ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                title: Text(opt),
                selected: _selected == opt,
                onTap: () => _finish(opt),
              ),
            )
          else
            TextField(
              controller: _ctrl,
              autofocus: true,
              decoration: InputDecoration(
                hintText: req.placeholder ?? '请输入',
                border: const OutlineInputBorder(),
              ),
            ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        if (!req.isChoice)
          FilledButton(
            onPressed: () => _finish(),
            child: const Text('确认'),
          ),
      ],
    );
  }
}
