// 砼智根应用冒烟测试：冷启动无配对时进入扫码配对页。
//
// （原默认 Counter 冒烟测试随 main.dart 改造移除：MyApp 已替换为 ConcreteApp。）

import 'package:concrete_agent/app.dart';
import 'package:concrete_agent/pages/PairPage.dart';
import 'package:concrete_agent/services/ConnectionService.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('砼智 冷启动无配对显示扫码配对页', (WidgetTester tester) async {
    addTearDown(() async {
      await tester.pumpWidget(const SizedBox());
    });
    await tester.pumpWidget(
      ConcreteApp(
        connectionService: ConnectionService(),
        scannerBuilder: (context, onDetect) => const Text('扫码区域'),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(PairPage), findsOneWidget);
    expect(find.text('扫码区域'), findsOneWidget);
  });
}
