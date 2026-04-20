// ignore_for_file: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qt33/src/data/providers.dart';

class UsersMobilePage extends ConsumerStatefulWidget {
  const UsersMobilePage({super.key});

  @override
  ConsumerState<UsersMobilePage> createState() => _UsersMobilePageState();
}

class _UsersMobilePageState extends ConsumerState<UsersMobilePage> {
  final _fullName = TextEditingController();
  final _mobile = TextEditingController();
  final _username = TextEditingController();
  String _role = 'normal_user';
  bool _active = true;
  String _substationId = '';
  String _editingId = '';
  List<Map<String, dynamic>> _substations = [];
  List<Map<String, dynamic>> _users = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    setState(() => _loading = true);
    final ws = ref.read(workspaceRepositoryProvider);
    _substations = await ws.listSubstations();
    _users = await ws.listLocalUsers();
    if (_substationId.isEmpty && _substations.isNotEmpty) {
      _substationId = _substations.first['id']?.toString() ?? '';
    }
    if (!mounted) return;
    setState(() => _loading = false);
  }

  void _resetForm() {
    setState(() {
      _editingId = '';
      _fullName.clear();
      _mobile.clear();
      _username.clear();
      _role = 'normal_user';
      _active = true;
    });
  }

  void _edit(Map<String, dynamic> user) {
    setState(() {
      _editingId = (user['id'] ?? '').toString();
      _fullName.text = (user['fullName'] ?? '').toString();
      _mobile.text = (user['mobile'] ?? '').toString();
      _username.text = (user['username'] ?? '').toString();
      _role = (user['role'] ?? 'normal_user').toString();
      _active = user['isActive'] == true;
      _substationId = (user['substationId'] ?? _substationId).toString();
    });
  }

  Future<void> _save() async {
    if (_username.text.trim().isEmpty || _fullName.text.trim().isEmpty) return;
    await ref.read(workspaceRepositoryProvider).upsertLocalUser(
      {
        'fullName': _fullName.text.trim(),
        'mobile': _mobile.text.trim(),
        'username': _username.text.trim(),
        'role': _role,
        'isActive': _active,
        'substationId': _substationId,
      },
      id: _editingId.isEmpty ? null : _editingId,
    );
    _resetForm();
    _reload();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('User saved')));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    return Scaffold(
      appBar: AppBar(title: const Text('Users')),
      body: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          const Text('Local offline users', style: TextStyle(fontWeight: FontWeight.w700)),
          TextField(controller: _fullName, decoration: const InputDecoration(labelText: 'Full name')),
          TextField(controller: _mobile, decoration: const InputDecoration(labelText: 'Mobile')),
          TextField(controller: _username, decoration: const InputDecoration(labelText: 'Username')),
          DropdownButtonFormField<String>(
            value: _role,
            decoration: const InputDecoration(labelText: 'Role'),
            items: const [
              DropdownMenuItem(value: 'super_admin', child: Text('Super Admin')),
              DropdownMenuItem(value: 'substation_admin', child: Text('Substation Admin')),
              DropdownMenuItem(value: 'normal_user', child: Text('Normal User')),
              DropdownMenuItem(value: 'viewer', child: Text('Viewer')),
            ],
            onChanged: (v) => setState(() => _role = v ?? 'normal_user'),
          ),
          DropdownButtonFormField<String>(
            value: _substationId.isEmpty ? null : _substationId,
            decoration: const InputDecoration(labelText: 'Assigned substation'),
            items: _substations
                .map((s) => DropdownMenuItem(value: s['id']?.toString(), child: Text((s['name'] ?? '').toString())))
                .toList(),
            onChanged: (v) => setState(() => _substationId = v ?? ''),
          ),
          SwitchListTile(
            title: const Text('Active'),
            value: _active,
            onChanged: (v) => setState(() => _active = v),
          ),
          Wrap(
            spacing: 8,
            children: [
              FilledButton(onPressed: _save, child: Text(_editingId.isEmpty ? 'Create user' : 'Update user')),
              OutlinedButton(onPressed: _resetForm, child: const Text('Reset')),
            ],
          ),
          const Divider(),
          const Text('User list', style: TextStyle(fontWeight: FontWeight.w700)),
          ..._users.map((u) {
            final subName = _substations
                .where((s) => s['id']?.toString() == (u['substationId'] ?? '').toString())
                .map((s) => (s['name'] ?? '').toString())
                .firstOrNull;
            return Card(
              child: ListTile(
                title: Text('${u['fullName'] ?? '-'} (${u['username'] ?? '-'})'),
                subtitle: Text('${u['role'] ?? '-'} | ${subName ?? '-'} | ${u['isActive'] == true ? 'Active' : 'Inactive'}'),
                onTap: () => _edit(u),
                trailing: IconButton(
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () async {
                    await ref.read(workspaceRepositoryProvider).deleteLocalUser((u['id'] ?? '').toString());
                    _reload();
                  },
                ),
              ),
            );
          }),
        ],
      ),
    );
  }
}
