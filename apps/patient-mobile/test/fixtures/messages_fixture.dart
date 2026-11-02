import 'dart:async';
import 'package:a_health_patient/core/messages_repository.dart';

class MessagesFixture extends MessagesRepository {
  bool fail = false, empty = false, paginated = false;
  Completer<void>? gate;
  final cursors = <String?>[];
  List<Map<String, dynamic>> rows = [
    {
      'id': 'synthetic-thread-one',
      'clinician_name': 'Dkt. Amina · Mfano',
      'reason_summary': 'Ufuatiliaji wa huduma',
      'status': 'open',
      'unread_count': 2,
      'last_message': {
        'body': 'Mfano: Unaendeleaje leo?',
        'created_at': DateTime.now().toUtc().toIso8601String()
      }
    },
    {
      'id': 'synthetic-thread-two',
      'clinician_name': 'Dkt. Juma · Mfano',
      'reason_summary': 'Majibu ya vipimo',
      'status': 'open',
      'unread_count': 0,
      'last_message': {
        'body': 'Mfano: Tutajadili majibu yako kwenye consultation.',
        'created_at': '2026-10-27T08:20:00Z'
      }
    },
    {
      'id': 'synthetic-thread-three',
      'clinician_name': null,
      'reason_summary': 'Consultation ya awali',
      'status': 'closed',
      'unread_count': 0,
      'last_message': null,
      'updated_at': '2026-10-20T08:20:00Z'
    },
  ];
  @override
  Future<Map<String, dynamic>> conversations({String? cursor}) async {
    cursors.add(cursor);
    if (gate != null) await gate!.future;
    if (fail) throw StateError('Synthetic offline');
    return {
      'data': empty
          ? []
          : cursor == null
              ? rows
              : [
                  ...rows.take(1),
                  {
                    'id': 'synthetic-older',
                    'clinician_name': 'Dkt. Neema · Mfano',
                    'status': 'open',
                    'unread_count': 0
                  }
                ],
      'meta': {'next_cursor': paginated && cursor == null ? 'older-page' : null}
    };
  }
}
