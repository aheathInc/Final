import '../core/l10n.dart';
import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import '../core/payment_bills.dart';
import '../core/phone.dart';
import '../core/session.dart';
import '../widgets/common.dart';
import '../widgets/premium.dart';
import '../widgets/receipt_download.dart';

class PaymentBillsScreen extends StatefulWidget {
  const PaymentBillsScreen({super.key, this.repository});
  final PaymentBillsRepository? repository;
  @override
  State<PaymentBillsScreen> createState() => _PaymentBillsScreenState();
}

class _PaymentBillsScreenState extends State<PaymentBillsScreen>
    with WidgetsBindingObserver {
  final _defaultRepository = PaymentBillsRepository();
  PaymentBillsRepository get repository =>
      widget.repository ?? _defaultRepository;
  final phone = TextEditingController(), email = TextEditingController();
  List<Map<String, dynamic>> bills = [];
  Map<String, dynamic>? options, selected, intent;
  String provider = 'mpesa';
  String? error, requestKey, requestBody;
  bool loading = true, busy = false, querying = false, foreground = true;
  int generation = 0, polls = 0;
  Timer? timer;
  BuildContext? paymentDialogContext;
  bool current(int epoch) => mounted && epoch == generation;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    Session.identityChanges.addListener(identityChanged);
    load();
  }

  void identityChanged() {
    generation++;
    timer?.cancel();
    final openDialog = paymentDialogContext;
    if (openDialog != null && openDialog.mounted)
      Navigator.of(openDialog).pop(false);
    paymentDialogContext = null;
    phone.clear();
    email.clear();
    if (mounted)
      setState(() {
        bills = [];
        options = null;
        selected = null;
        intent = null;
        error = null;
        busy = false;
        querying = false;
        requestKey = null;
        requestBody = null;
      });
    load();
  }

  @override
  void dispose() {
    generation++;
    timer?.cancel();
    Session.identityChanges.removeListener(identityChanged);
    WidgetsBinding.instance.removeObserver(this);
    phone.dispose();
    email.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    foreground = state == AppLifecycleState.resumed;
    if (foreground) {
      polls = 0;
      schedulePoll();
    } else {
      timer?.cancel();
    }
  }

  Future<void> load() async {
    if (busy || querying) return;
    final epoch = ++generation;
    timer?.cancel();
    setState(() {
      loading = true;
      error = null;
      bills = [];
      options = null;
    });
    try {
      if (!await Session.authenticated)
        throw FormatException(L.tr('Sign in first'));
      final results = await Future.wait<Object?>(
          [repository.bills(), repository.options(), Session.user()]);
      if (!current(epoch)) return;
      setState(() {
        bills = results[0] as List<Map<String, dynamic>>;
        options = results[1] as Map<String, dynamic>;
        final user = results[2];
        if (phone.text.isEmpty && user is Map)
          phone.text = user['phone_number'] as String? ?? '';
      });
    } catch (_) {
      if (current(epoch))
        setState(() {
          error = L.tr(
              'Bili hazikupatikana. Hakuna malipo yaliyothibitishwa. Ingia na ujaribu tena.');
        });
    } finally {
      if (current(epoch)) {
        setState(() => loading = false);
        schedulePoll();
      }
    }
  }

  bool get pending =>
      intent != null &&
      ['pending', 'processing', 'requires_action'].contains(intent!['status']);
  void schedulePoll() {
    timer?.cancel();
    if (!mounted || !foreground || !pending || polls >= 24) return;
    timer = Timer(const Duration(seconds: 5), () {
      polls++;
      refreshIntent();
    });
  }

  Future<void> refreshIntent() async {
    if (intent == null || querying) return;
    final epoch = generation, id = intent!['id'] as String;
    setState(() => querying = true);
    try {
      final result = await repository.intent(id);
      if (current(epoch))
        setState(() {
          intent = result;
          error = null;
        });
    } catch (_) {
      if (current(epoch))
        setState(() => error = L.tr(
            'Hali haikuthibitishwa. Usilipe tena kabla ya kuhakiki ombi hili.'));
    } finally {
      if (current(epoch)) {
        setState(() => querying = false);
        schedulePoll();
      }
    }
  }

  Future<void> pay() async {
    if (selected == null || selected!['payable'] == false || busy || pending)
      return;
    final number = toE164(phone.text);
    if (number == null || !RegExp(r'^\+255\d{9}$').hasMatch(number)) {
      setState(() => error = L.tr('Weka namba sahihi ya wallet ya Tanzania.'));
      return;
    }
    if (options?['requires_email'] == true &&
        !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(email.text.trim())) {
      setState(
          () => error = L.tr('Provider anahitaji email halali ya mlipaji.'));
      return;
    }
    final epoch = generation;
    final bill = Map<String, dynamic>.from(selected!);
    final environment = options?['environment'];
    final approved = await showDialog<bool>(
        context: context,
        builder: (context) {
          paymentDialogContext = context;
          return AlertDialog(
              title: Text(L.tr('Thibitisha ombi la malipo')),
              content: Text(L.tr(
                  "{0}\n{1} {2}\nWallet: {3}\n\n{4}\nUsiweke PIN ya wallet kwenye A-Health.",
                  [
                    bill['title'],
                    bill['amount'],
                    bill['currency'],
                    number,
                    environment == 'live'
                        ? 'Fedha halisi zinaweza kukatwa baada ya kuidhinisha kwa provider.'
                        : 'MAZINGIRA YA MAJARIBIO: si malipo ya live.'
                  ])),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(context, false),
                    child: Text(L.tr('Rudi'))),
                FilledButton(
                    onPressed: () => Navigator.pop(context, true),
                    child: Text(L.tr('Omba malipo')))
              ]);
        });
    paymentDialogContext = null;
    if (!current(epoch) || approved != true) return;
    final body = jsonEncode([bill['id'], provider, number, email.text.trim()]);
    if (requestBody != body) {
      requestKey = repository.newKey();
      requestBody = body;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final result = await repository.pay(
          billId: bill['id'] as String,
          provider: provider,
          phone: number,
          email: email.text.trim(),
          key: requestKey!);
      if (current(epoch))
        setState(() {
          intent = result;
          polls = 0;
        });
    } catch (_) {
      if (current(epoch))
        setState(() => error = L.tr(
            'Jibu halijapatikana. Usifanye malipo tofauti; retry itatumia ombi lilelile.'));
    } finally {
      if (current(epoch)) {
        setState(() => busy = false);
        schedulePoll();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    return Scaffold(
      appBar: AppBar(title: Text(L.tr('Bili na risiti'))),
      body: RefreshIndicator(
          onRefresh: load,
          child: ListView(padding: const EdgeInsets.all(20), children: [
            PremiumAuroraHero(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  Text(L.tr('Lipia huduma yako'),
                      style: Theme.of(context)
                          .textTheme
                          .headlineSmall
                          ?.copyWith(color: Colors.white)),
                  const SizedBox(height: 8),
                  Text(
                      L.tr(
                          'Bili kutoka kwa mtoa huduma. Kiasi hakiwekwi na mgonjwa. Risiti hutolewa baada ya uthibitisho.'),
                      style: TextStyle(color: Colors.white)),
                ])),
            const SizedBox(height: 16),
            if (options != null && options!['environment'] != 'live')
              Notice(
                  L.tr(
                      "MAJARIBIO ({0}): rekodi hizi si uthibitisho wa fedha halisi.",
                      [options!['environment']]),
                  tone: NoticeTone.attention),
            if (error != null) Notice(error!),
            if (loading)
              const Center(child: CircularProgressIndicator())
            else if (bills.isEmpty && error == null)
              Empty(L.tr(
                  'Hakuna bili iliyotolewa. Bili huandaliwa na staff mwenye ruhusa.'))
            else
              ...bills.map((b) => Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: PremiumCard(
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                        Text(b['title'] as String,
                            style: Theme.of(context).textTheme.titleMedium),
                        Text('${b['amount']} ${b['currency']}',
                            style: Theme.of(context).textTheme.headlineSmall),
                        Text('${b['reference']} · ${b['status']}'),
                        if (['paid', 'refunded'].contains(b['status']))
                          ReceiptDownload(billId: b['id'] as String),
                        if (b['payment_block_reason'] != null)
                          Text(b['payment_block_reason'] as String),
                        if (b['status'] == 'due' &&
                            b['payable'] != false &&
                            DateTime.tryParse(b['expires_at'] as String? ?? '')
                                    ?.isAfter(DateTime.now()) ==
                                true)
                          OutlinedButton(
                              onPressed: busy || pending || querying
                                  ? null
                                  : () {
                                      setState(() {
                                        selected = b;
                                        intent = null;
                                        requestBody = null;
                                        requestKey = null;
                                        error = null;
                                      });
                                    },
                              child: Text(L.tr('Chagua bili'))),
                      ])))),
            if (selected != null && options != null && intent == null) ...[
              SectionTitle(L.tr('Njia ya malipo')),
              Text(selected!['title'] as String),
              ...{
                'mpesa': 'M-Pesa',
                'tigo_pesa': 'Mixx by Yas (Tigo Pesa)',
                'airtel_money': 'Airtel Money'
              }
                  .entries
                  .where((e) => (options!['providers'] as List).contains(e.key))
                  .map((e) => RadioListTile<String>(
                      title: Text(e.value),
                      value: e.key,
                      groupValue: provider,
                      onChanged: busy
                          ? null
                          : (value) => setState(() => provider = value!))),
              TextField(
                  controller: phone,
                  keyboardType: TextInputType.phone,
                  enabled: !busy,
                  decoration:
                      InputDecoration(labelText: L.tr('Namba ya wallet'))),
              if (options!['requires_email'] == true) ...[
                const SizedBox(height: 12),
                TextField(
                    controller: email,
                    keyboardType: TextInputType.emailAddress,
                    enabled: !busy,
                    decoration: InputDecoration(
                        labelText: L.tr('Email inayotakiwa na provider')))
              ],
              const SizedBox(height: 12),
              Text(L.tr(
                  'Hakuna PIN ya M-Pesa, Mixx au Airtel inayohitajika ndani ya A-Health.')),
              FilledButton(
                  onPressed: busy ? null : pay,
                  child: Text(busy
                      ? L.tr('Inaomba malipo…')
                      : L.tr('Kagua na omba malipo'))),
            ],
            if (intent != null)
              PremiumCard(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                    Text(
                        intent!['status'] == 'succeeded'
                            ? (intent!['environment'] == 'live'
                                ? L.tr('Malipo yamethibitishwa')
                                : L.tr(
                                    'Majaribio yamethibitishwa — si fedha halisi'))
                            : L.tr("Hali ya ombi: {0}", [intent!['status']]),
                        style: Theme.of(context).textTheme.titleLarge),
                    Text(L
                        .tr("Reference: {0}", [intent!['provider_reference']])),
                    Text(L.tr("Kiasi: {0} {1}",
                        [intent!['amount'], intent!['currency']])),
                    if (intent!['payment_id'] != null)
                      Text(L.tr("Risiti: {0}", [intent!['payment_id']])),
                    if (intent!['payment_id'] != null &&
                        selected?['id'] is String)
                      ReceiptDownload(billId: selected!['id'] as String),
                    if (intent!['client_action'] is Map)
                      Text((intent!['client_action'] as Map)['message']
                              as String? ??
                          ''),
                    Text(L.tr(
                        'Kuomba malipo hakumaanishi umelipa. Uthibitisho hutoka kwa provider, si kitufe kwenye app.')),
                    OutlinedButton(
                        onPressed: querying ? null : refreshIntent,
                        child: Text(L.tr('Sasisha hali'))),
                    if (!pending)
                      TextButton(
                          onPressed: () {
                            setState(() {
                              intent = null;
                              selected = null;
                              requestBody = null;
                              requestKey = null;
                            });
                            load();
                          },
                          child: Text(L.tr('Rudi kwenye bili'))),
                  ])),
          ])),
    );
  }
}
