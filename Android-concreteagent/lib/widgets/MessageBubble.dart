// ignore_for_file: file_names
// 文件名 MessageBubble 为任务简报指定的 PascalCase 命名，保持原样。

import 'package:flutter/material.dart';

/// 单条对话气泡：用户消息右蓝、AI 消息左灰；流式时显示光标；错误时红底提示。
class MessageBubble extends StatelessWidget {
  const MessageBubble({
    super.key,
    required this.role,
    required this.text,
    this.streaming = false,
    this.error,
  });

  /// 'user' | 'assistant'
  final String role;

  /// 消息文本（流式时为已累积的增量）。
  final String text;

  /// 是否正在流式输出（尾部显示光标）。
  final bool streaming;

  /// 错误提示（非空时以错误样式展示）。
  final String? error;

  bool get isUser => role == 'user';

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final bg = error != null
        ? scheme.errorContainer
        : (isUser ? scheme.primaryContainer : scheme.surfaceContainerHighest);
    final fg = error != null
        ? scheme.onErrorContainer
        : (isUser ? scheme.onPrimaryContainer : scheme.onSurface);

    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 12),
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 14),
        constraints: const BoxConstraints(maxWidth: 320),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: const Radius.circular(16),
            bottomLeft: Radius.circular(isUser ? 16 : 4),
            bottomRight: Radius.circular(isUser ? 4 : 16),
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              streaming ? '$text▍' : text,
              style: TextStyle(color: fg),
            ),
            if (error != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  '⚠️ $error',
                  style: TextStyle(color: scheme.onErrorContainer, fontSize: 12),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
