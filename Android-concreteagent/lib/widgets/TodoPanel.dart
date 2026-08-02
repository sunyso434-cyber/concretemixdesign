// ignore_for_file: file_names
// 文件名 TodoPanel 为任务简报指定的 PascalCase 命名，保持原样。

import 'package:flutter/material.dart';

/// Todo 面板：只读展示 agent 维护的任务清单（状态流转由 agent 负责）。
///
/// todo 项结构与电脑端 todo-manage skill 对齐：
/// `{ id, content, priority, status, createdAt, updatedAt }`
/// - priority: 'high' | 'medium' | 'low'
/// - status:   'pending' | 'in_progress' | 'completed'
class TodoPanel extends StatelessWidget {
  const TodoPanel({super.key, required this.todos, this.total, this.completed});

  final List<Map<String, dynamic>> todos;
  final int? total;
  final int? completed;

  int get _total => total ?? todos.length;

  int get _completed =>
      completed ?? todos.where((t) => t['status'] == 'completed').length;

  Color _priorityColor(String? p) {
    switch (p) {
      case 'high':
        return Colors.redAccent;
      case 'low':
        return Colors.green;
      default:
        return Colors.orange;
    }
  }

  String _priorityLabel(String? p) {
    switch (p) {
      case 'high':
        return '高';
      case 'low':
        return '低';
      default:
        return '中';
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      height: 170,
      margin: const EdgeInsets.fromLTRB(12, 4, 12, 4),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHigh,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
            child: Row(
              children: [
                Icon(Icons.checklist, size: 18, color: scheme.primary),
                const SizedBox(width: 6),
                const Text('任务清单', style: TextStyle(fontWeight: FontWeight.bold)),
                const Spacer(),
                Text(
                  '$_completed/$_total',
                  style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: todos.isEmpty
                ? Center(
                    child: Text(
                      '暂无任务',
                      style: TextStyle(color: scheme.onSurfaceVariant),
                    ),
                  )
                : ListView.builder(
                    padding: EdgeInsets.zero,
                    itemCount: todos.length,
                    itemBuilder: (_, i) {
                      final t = todos[i];
                      final done = t['status'] == 'completed';
                      final content = (t['content'] as String?) ?? '';
                      final priority = t['priority'] as String?;
                      return ListTile(
                        dense: true,
                        visualDensity: VisualDensity.compact,
                        leading: Icon(
                          done
                              ? Icons.check_box
                              : Icons.check_box_outline_blank,
                          size: 20,
                          color: done ? scheme.primary : scheme.onSurfaceVariant,
                        ),
                        title: Text(
                          content,
                          style: TextStyle(
                            decoration:
                                done ? TextDecoration.lineThrough : null,
                            color:
                                done ? scheme.onSurfaceVariant : null,
                          ),
                        ),
                        trailing: priority == null
                            ? null
                            : Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 6,
                                  vertical: 2,
                                ),
                                decoration: BoxDecoration(
                                  color: _priorityColor(priority)
                                      .withValues(alpha: 0.15),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  _priorityLabel(priority),
                                  style: TextStyle(
                                    fontSize: 11,
                                    color: _priorityColor(priority),
                                  ),
                                ),
                              ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
