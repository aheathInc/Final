import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:dio/dio.dart';
import 'package:local_auth_platform_interface/local_auth_platform_interface.dart';
import 'package:a_health_patient/core/api.dart';
import 'package:a_health_patient/core/biometrics.dart';
import 'package:a_health_patient/core/session.dart';

const user = {
  'id': 'synthetic-bio',
  'role': 'patient',
  'phone_number': '+255700000099'
};

class SuccessfulAuth extends LocalAuthPlatform {
  Completer<bool>? result;
  @override
  Future<bool> authenticate(
          {required String localizedReason,
          required Iterable<AuthMessages> authMessages,
          AuthenticationOptions options =
              const AuthenticationOptions()}) async =>
      result == null ? true : await result!.future;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final native = LocalAuthPlatform.instance;
  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    await Session.clear();
    await Session.save(
        accessToken: 'expired', refreshToken: 'refresh-once', user: user);
    await Session.setBiometric(true);
  });
  tearDown(() {
    Api.useDioForTesting(null);
    LocalAuthPlatform.instance = native;
  });

  test(
      'biometric success plus simultaneous expired requests keeps account open with one rotation',
      () async {
    LocalAuthPlatform.instance = SuccessfulAuth();
    Session.locked.value = true;
    expect(await Biometrics.unlock(), isTrue);
    expect(Session.locked.value, isFalse);
    final refreshArrived = Completer<void>(), release = Completer<void>();
    var rotations = 0;
    Api.useDioForTesting(Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (o, h) async {
        if (o.path.endsWith('/auth/token/refresh')) {
          rotations++;
          if (!refreshArrived.isCompleted) refreshArrived.complete();
          await release.future;
          h.resolve(Response(
              requestOptions: o,
              statusCode: 200,
              data: {'access_token': 'renewed', 'refresh_token': 'rotated'}));
        } else {
          final valid = o.headers['Authorization'] == 'Bearer renewed';
          h.resolve(Response(
              requestOptions: o,
              statusCode: valid ? 200 : 401,
              data: valid ? {'ok': true} : {}));
        }
      })));
    final first = Api.get('/users/me'),
        second = Api.get('/patient-profiles/me');
    await refreshArrived.future;
    await Future<void>.delayed(const Duration(milliseconds: 15));
    release.complete();
    expect(await first, {'ok': true});
    expect(await second, {'ok': true});
    expect(rotations, 1);
    expect(await Session.refreshToken(), 'rotated');
    expect(await Session.userId(), user['id']);
    expect(Session.locked.value, isFalse);
  });
  test(
      'late old-token rejection reuses renewed token without a second rotation',
      () async {
    final oldResponse = Completer<void>();
    var rotations = 0;
    Api.useDioForTesting(Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (o, h) async {
        if (o.path.endsWith('/auth/token/refresh')) {
          rotations++;
          h.resolve(Response(
              requestOptions: o,
              statusCode: 200,
              data: {'access_token': 'renewed', 'refresh_token': 'rotated'}));
        } else {
          final valid = o.headers['Authorization'] == 'Bearer renewed';
          if (o.path.endsWith('/patient-profiles/me') && !valid) {
            await oldResponse.future;
          }
          h.resolve(Response(
              requestOptions: o, statusCode: valid ? 200 : 401, data: {}));
        }
      })));
    final late = Api.get('/patient-profiles/me');
    await Api.get('/users/me');
    oldResponse.complete();
    await late;
    expect(rotations, 1);
    expect(await Session.authenticated, isTrue);
  });
  for (final offline in [true, false]) {
    test(
        'refresh ${offline ? 'network error' : 'service outage'} retains biometric session',
        () async {
      Api.useDioForTesting(Dio()
        ..interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
          if (o.path.endsWith('/auth/token/refresh') && offline) {
            h.reject(DioException(
                requestOptions: o, type: DioExceptionType.connectionError));
          } else {
            h.resolve(Response(
                requestOptions: o,
                statusCode: o.path.endsWith('/auth/token/refresh') ? 503 : 401,
                data: {}));
          }
        })));
      await expectLater(Api.get('/users/me'), throwsA(anything));
      expect(await Session.accessToken(), 'expired');
      expect(await Session.refreshToken(), 'refresh-once');
      expect(Session.biometricEnabled, isTrue);
    });
  }
  test('server revocation still requires account authentication', () async {
    Api.useDioForTesting(Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
        h.resolve(Response(requestOptions: o, statusCode: 401, data: {}));
      })));
    await expectLater(Api.get('/users/me'), throwsA(isA<ApiException>()));
    expect(await Session.authenticated, isFalse);
  });
  test('refresh completing after logout cannot resurrect credentials',
      () async {
    final arrived = Completer<void>(), release = Completer<void>();
    Api.useDioForTesting(Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (o, h) async {
        if (o.path.endsWith('/auth/token/refresh')) {
          arrived.complete();
          await release.future;
          h.resolve(Response(requestOptions: o, statusCode: 200, data: {
            'access_token': 'old-renewal',
            'refresh_token': 'old-rotation'
          }));
        } else {
          h.resolve(Response(requestOptions: o, statusCode: 401, data: {}));
        }
      })));
    final request =
        expectLater(Api.get('/users/me'), throwsA(isA<ApiException>()));
    await arrived.future;
    await Session.clear();
    release.complete();
    await request;
    expect(await Session.authenticated, isFalse);
  });
  test(
      'biometric result for a signed out account cannot unlock another identity',
      () async {
    final auth = SuccessfulAuth()..result = Completer<bool>();
    LocalAuthPlatform.instance = auth;
    Session.locked.value = true;
    final pending = Biometrics.unlock();
    await Session.clear();
    Session.locked.value = true;
    auth.result!.complete(true);
    expect(await pending, isFalse);
    expect(Session.locked.value, isTrue);
    Session.locked.value = false;
  });
}
