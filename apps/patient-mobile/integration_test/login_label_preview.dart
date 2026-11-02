// Isolated native visual fixture; never stores a real account or sends requests.
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:dio/dio.dart';
import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/session.dart';
import 'package:a_health_patient/core/theme.dart';
import 'package:a_health_patient/screens/login_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  FlutterSecureStorage.setMockInitialValues({});
  Api.useDioForTesting(Dio()..interceptors.add(InterceptorsWrapper(onRequest: (request, handler) {
    handler.resolve(Response(requestOptions: request, statusCode: 422, data: {'error': {'message': 'Muonekano wa majaribio.'}}));
  })));
  await Session.save(accessToken: 'synthetic', refreshToken: 'synthetic', user: {
    'id': 'synthetic-label', 'role': 'patient', 'full_name': 'Synthetic Test Patient', 'phone_number': '+255700000001',
  });
  await Session.clear();
  runApp(MaterialApp(theme: buildTheme(), darkTheme: buildDarkTheme(), themeMode: ThemeMode.system, debugShowCheckedModeBanner: false, home: const LoginScreen()));
}
