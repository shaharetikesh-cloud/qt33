import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:qt33/src/shared/session_provider.dart';

class LoginPage extends ConsumerStatefulWidget {
  const LoginPage({super.key});

  @override
  ConsumerState<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends ConsumerState<LoginPage> {
  final _formKey = GlobalKey<FormState>();
  final _userId = TextEditingController(text: 'operator01');
  final _name = TextEditingController(text: 'QT33 Operator');
  String _role = 'normal_user';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Form(
                key: _formKey,
                child: SingleChildScrollView(
                  child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Image.asset('assets/branding/qt33_logo.png', height: 96, errorBuilder: (_, __, ___) => const Icon(Icons.bolt, size: 80)),
                    const SizedBox(height: 16),
                    const Text('QT33', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 24),
                    TextFormField(
                      controller: _userId,
                      decoration: const InputDecoration(labelText: 'User ID'),
                      validator: (v) => (v == null || v.isEmpty) ? 'User ID required' : null,
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: _name,
                      decoration: const InputDecoration(labelText: 'Full Name'),
                      validator: (v) => (v == null || v.isEmpty) ? 'Name required' : null,
                    ),
                    const SizedBox(height: 8),
                    const Align(
                      alignment: Alignment.centerLeft,
                      child: Text('Role', style: TextStyle(fontWeight: FontWeight.w600)),
                    ),
                    RadioGroup<String>(
                      groupValue: _role,
                      onChanged: (v) => setState(() => _role = v ?? 'normal_user'),
                      child: const Column(
                        children: [
                          RadioListTile<String>(
                            title: Text('Super Admin'),
                            value: 'super_admin',
                          ),
                          RadioListTile<String>(
                            title: Text('Substation Admin'),
                            value: 'substation_admin',
                          ),
                          RadioListTile<String>(
                            title: Text('Normal User'),
                            value: 'normal_user',
                          ),
                          RadioListTile<String>(
                            title: Text('Viewer'),
                            value: 'viewer',
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 18),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        onPressed: () {
                          if (!_formKey.currentState!.validate()) return;
                          ref.read(sessionControllerProvider.notifier).login(
                                userId: _userId.text.trim(),
                                fullName: _name.text.trim(),
                                role: _role,
                              );
                          context.go('/');
                        },
                        child: const Text('Login / प्रवेश करा'),
                      ),
                    ),
                  ],
                ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
