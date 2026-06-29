#!/usr/bin/env python3
"""Patch write-handler.js: add reports/ mkdir defense"""
import sys

with open('src/main/workspace/write-handler.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 用 index + 切片定位（最稳）
marker_start = '// 3) '
# 找到 // 3) 位置
idx = content.find(marker_start)
if idx < 0:
    print("ERROR: marker not found")
    sys.exit(1)

# 从 idx 开始找到 块结束（第一个 WRITE_FAIL throw 之后 }）
end_marker = "  }\n"
# 找下一个 throw new WorkspaceError('WRITE_FAIL'...之后 } 的位置
throw_start = content.find("throw new WorkspaceError('WRITE_FAIL', `写入文件失败", idx)
if throw_start < 0:
    print("ERROR: throw not found")
    sys.exit(1)
# 找 } 结束位置
end_idx = content.find(end_marker, throw_start)
if end_idx < 0:
    print("ERROR: end marker not found")
    sys.exit(1)
block_end = end_idx + len(end_marker)

print(f"Block from {idx} to {block_end}")
print("OLD BLOCK:")
print(content[idx:block_end])
print("---")

old_block = content[idx:block_end]
new_block = (
    "// 3) 写盘到 <workspacePath>/reports/\n"
    "  // v9.1.0 防御：mkdir -p reports/ 兜底（工作区 reports/ 被误删时不报错）\n"
    "  const reportsDir = path.posix.join(current.path, 'reports')\n"
    "  try {\n"
    "    await fs.mkdir(reportsDir, { recursive: true })\n"
    "  } catch (err) {\n"
    "    throw new WorkspaceError('WRITE_FAIL', `创建 reports/ 目录失败：${err.message}`, true, err)\n"
    "  }\n"
    "  const targetPath = path.posix.join(reportsDir, filename)\n"
    "  try {\n"
    "    await fs.writeFile(targetPath, buf)\n"
    "  } catch (err) {\n"
    "    throw new WorkspaceError('WRITE_FAIL', `写入文件失败：${err.message}`, true, err)\n"
    "  }\n"
)

new_content = content[:idx] + new_block + content[block_end:]
with open('src/main/workspace/write-handler.js', 'w', encoding='utf-8') as f:
    f.write(new_content)
print("SUCCESS")