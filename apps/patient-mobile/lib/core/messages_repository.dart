import 'api.dart';

class MessagesRepository {
  Future<Map<String, dynamic>> conversations({String? cursor}) async =>
      Map<String, dynamic>.from(await Api.get('/care-threads', query: {
        'limit': 25,
        if (cursor != null) 'cursor': cursor,
      }));
}
