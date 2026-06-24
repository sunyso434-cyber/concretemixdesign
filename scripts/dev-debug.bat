@echo off
REM 用法：把此文件放到和 .exe 同目录下，双击运行
REM 日志会写入同目录的 debug.log
REM 1. 关掉所有已经打开的混凝土配合比设计软件
REM 2. 双击此文件
REM 3. 触发你的操作（拖入文件、切换工作区）
REM 4. 关闭 app
REM 5. 用记事本打开 debug.log

setlocal
set EXE=混凝土配合比设计软件-8.3.0-x64.exe

if not exist "%EXE%" (
  if exist "混凝土配合比设计软件 Setup 8.3.0.exe" (
    set EXE=混凝土配合比设计软件 Setup 8.3.0.exe
  ) else (
    echo ❌ 没找到 EXE，请把此文件放到含 .exe 的目录
    pause
    exit /b 1
  )
)

echo ▶ 启动 %EXE%，日志写入 debug.log ...
echo.
set ELECTRON_ENABLE_LOGGING=1
set ELECTRON_ENABLE_STACK_DUMPING=1
call "%EXE%" --enable-logging=stderr --v=1 2>debug.log
echo.
echo ▶ 已退出。日志在当前目录的 debug.log
pause
