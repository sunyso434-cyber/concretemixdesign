@echo off
REM 用法：双击运行，会启动 app 并把主进程日志输出到 debug.log
REM 1. 关掉所有已经打开的混凝土配合比设计软件
REM 2. 双击此文件
REM 3. 触发你之前的操作（拖入文件、开关工作区）
REM 4. 关闭 app
REM 5. 看 debug.log

setlocal
set INSTALL_DIR=%LOCALAPPDATA%\Programs\混凝土配合比设计软件
set EXE=%INSTALL_DIR%\混凝土配合比设计软件.exe

if not exist "%EXE%" (
  echo ❌ 没找到 %EXE%
  echo 如果是绿色版（便携版），把 EXE 路径改成下面那行
  pause
  exit /b 1
)

cd /d "%INSTALL_DIR%"
echo ▶ 启动 %EXE%，日志写入 debug.log ...
echo.
"%EXE%" --enable-logging > debug.log 2>&1
echo.
echo ▶ 已退出。日志在 %INSTALL_DIR%\debug.log
pause
