import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qt33/src/data/module_record_repository.dart';
import 'package:qt33/src/data/workspace_repository.dart';
import 'package:qt33/src/features/reports/pdf_export_service.dart';

final workspaceRepositoryProvider = Provider((ref) => WorkspaceRepository());
final moduleRecordRepositoryProvider = Provider((ref) => ModuleRecordRepository());
final pdfExportServiceProvider = Provider((ref) => PdfExportService());
