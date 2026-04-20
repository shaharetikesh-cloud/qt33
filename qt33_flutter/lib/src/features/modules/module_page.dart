import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:qt33/src/data/module_record_repository.dart';
import 'package:qt33/src/shared/module_registry.dart';
import 'package:qt33/src/shared/rbac.dart';
import 'package:qt33/src/shared/session_provider.dart';

final _repoProvider = Provider((ref) => ModuleRecordRepository());

class ModulePage extends ConsumerStatefulWidget {
  const ModulePage({super.key, required this.moduleKey});
  final String moduleKey;

  @override
  ConsumerState<ModulePage> createState() => _ModulePageState();
}

class _ModulePageState extends ConsumerState<ModulePage> {
  final _search = TextEditingController();
  bool _loading = false;
  List<ModuleRecord> _records = const [];

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    setState(() => _loading = true);
    final repo = ref.read(_repoProvider);
    final records = await repo.listByModule(widget.moduleKey, query: _search.text);
    if (!mounted) return;
    setState(() {
      _records = records;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionControllerProvider);
    final role = session?.role ?? Qt33Role.normalUser;
    final permission = permissionForRole(role);
    final module = qt33Modules.where((m) => m.key == widget.moduleKey).firstOrNull;
    final title = module?.title ?? widget.moduleKey;
    final formatter = DateFormat('dd MMM yyyy, HH:mm');

    return Scaffold(
      appBar: AppBar(title: Text(title)),
      floatingActionButton: permission.create
          ? FloatingActionButton.extended(
              onPressed: () => _showQuickEntryDialog(context),
              icon: const Icon(Icons.add),
              label: const Text('Quick Entry'),
            )
          : null,
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: TextField(
              controller: _search,
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.search),
                hintText: 'Search / शोधा',
                suffixIcon: IconButton(onPressed: _reload, icon: const Icon(Icons.tune)),
              ),
              onSubmitted: (_) => _reload(),
            ),
          ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : ListView.builder(
                    itemCount: _records.length,
                    itemBuilder: (_, i) {
                      final row = _records[i];
                      return Card(
                        margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        child: ListTile(
                          title: Text(row.title.isEmpty ? '(Untitled)' : row.title),
                          subtitle: Text('Updated: ${formatter.format(row.updatedAt.toLocal())}'),
                          onTap: () => _showRecord(context, row),
                          trailing: permission.delete
                              ? IconButton(
                                  onPressed: () async {
                                    await ref.read(_repoProvider).delete(row.id);
                                    _reload();
                                  },
                                  icon: const Icon(Icons.delete_outline),
                                )
                              : null,
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }

  Future<void> _showQuickEntryDialog(BuildContext context) async {
    final titleCtrl = TextEditingController();
    final remarksCtrl = TextEditingController();
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) {
        return Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: titleCtrl,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(labelText: 'Title'),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: remarksCtrl,
                minLines: 2,
                maxLines: 4,
                decoration: const InputDecoration(labelText: 'Remarks'),
              ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () async {
                    await ref.read(_repoProvider).upsert(
                          moduleKey: widget.moduleKey,
                          title: titleCtrl.text.trim(),
                          payload: {
                            'remarks': remarksCtrl.text.trim(),
                            'savedAt': DateTime.now().toIso8601String(),
                          },
                        );
                    if (!context.mounted) return;
                    Navigator.pop(context);
                    _reload();
                  },
                  child: const Text('Save / जतन करा'),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _showRecord(BuildContext context, ModuleRecord row) async {
    await showDialog<void>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(row.title),
        content: SingleChildScrollView(child: Text(row.payload.toString())),
        actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close'))],
      ),
    );
  }
}
