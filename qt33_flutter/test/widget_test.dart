import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qt33/src/app.dart';

void main() {
  testWidgets('QT33 app loads home shell', (WidgetTester tester) async {
    await tester.pumpWidget(const ProviderScope(child: Qt33App()));
    await tester.pumpAndSettle();
    expect(find.textContaining('QT33'), findsWidgets);
  });
}
