# School Management System — Build Plan

> Last updated: 2026-03-27
> Track progress here after each phase is completed. Mark phases ✅ when done.

---

## Architecture Layers

```
Layer 4: Outputs          Reports · Transcripts · Parent Portal · Communication Hub
Layer 3: Academic Logic   CBC · 8-4-4 · Attendance · Discipline
Layer 2: People & Setup   SIS depth · Guardian contacts · Documents
Layer 1: Foundation       Curriculum type · Extended student record  ← start
```

Layers must be built in dependency order. CBC reports need solid student records.
Attendance needs student-class relationships. Everything needs Layer 1.

---

## The One Decision Made First

**`curriculum_type` per tenant** — drives all downstream academic logic.

| Value   | Grading unit              | Report format              |
|---------|---------------------------|----------------------------|
| `CBC`   | Strand/sub-strand         | Performance level (BE/AE/ME/EE) |
| `8-4-4` | Subject marks (0–100)     | Letter grade + position in class |
| `IGCSE` | Subject grades (A*–G)     | Cambridge-style transcript  |

Column: `curriculum_type VARCHAR(20) DEFAULT 'CBC'` on `core.tenants`.

---

## Phase 0 — Curriculum Type Foundation
**Status:** ✅ Complete — 2026-03-27 · 10/10 tests passing

### What
- Add `curriculum_type` to `core.tenants`
- Expose in tenant profile read/write (director can set it, secretary can read it)
- Permissions: `structure.read` (read), `structure.manage` (write)

### Migrations
- `c3d4e5f6g7h8` — add `curriculum_type` column to `core.tenants`

### Files changed
- `backend/alambic/versions/c3d4e5f6g7h8_add_curriculum_type_to_tenants.py`
- `backend/app/models/tenant.py` — add column to ORM model
- `backend/app/api/v1/tenants/routes.py` — expose in profile + update endpoints
- `backend/tests/test_sis_phase0.py`

### Tests
- Director can read curriculum_type from tenant profile
- Director can update curriculum_type (CBC / 8-4-4 / IGCSE)
- Invalid value rejected (400)
- Secretary can read but cannot write curriculum_type

---

## Phase 1 — SIS Depth (Student + Guardian + Docs)
**Status:** ✅ Complete — 2026-03-27 · 36/36 tests passing

### What
Extend the thin student record into a real SIS. Once a student is enrolled
the system must hold their full bio-data, guardian contact info (not just
the auth user), emergency contacts (non-guardian), and document attachments.

### Migrations
| ID | Description |
|----|-------------|
| `d4e5f6g7h8i9` | Extend `core.students` with bio-data columns |
| `e5f6g7h8i9j0` | Extend `core.parents` with contact + name columns |
| `f6g7h8i9j0k1` | Create `core.student_emergency_contacts` |
| `g7h8i9j0k1l2` | Create `core.student_documents` |
| `h8i9j0k1l2m3` | Seed SIS permissions |

### New columns — `core.students`
| Column | Type | Notes |
|--------|------|-------|
| `phone` | varchar(50) | Student own phone (secondary school) |
| `email` | varchar(200) | Student own email |
| `nationality` | varchar(80) | e.g. Kenyan |
| `religion` | varchar(80) | |
| `home_address` | text | Full home address |
| `county` | varchar(80) | Kenyan county |
| `sub_county` | varchar(80) | |
| `upi` | varchar(100) | NEMIS UPI number |
| `birth_certificate_no` | varchar(100) | |
| `previous_school` | varchar(200) | School name |
| `previous_class` | varchar(80) | e.g. Grade 5 |

### New columns — `core.parents`
| Column | Type | Notes |
|--------|------|-------|
| `first_name` | varchar(120) | |
| `last_name` | varchar(120) | |
| `phone` | varchar(50) | Primary contact number |
| `phone_alt` | varchar(50) | Alternative number |
| `email` | varchar(200) | |
| `id_type` | varchar(30) | NATIONAL_ID / PASSPORT / OTHER |
| `address` | text | Home address |

### New table — `core.student_emergency_contacts`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `student_id` | uuid FK → students | |
| `name` | varchar(120) NOT NULL | |
| `relationship` | varchar(80) | UNCLE / AUNT / GRANDPARENT / etc. |
| `phone` | varchar(50) NOT NULL | |
| `phone_alt` | varchar(50) | |
| `email` | varchar(200) | |
| `is_primary` | boolean DEFAULT false | |
| `notes` | varchar(500) | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### New table — `core.student_documents`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `student_id` | uuid FK → students | |
| `document_type` | varchar(80) | BIRTH_CERTIFICATE / TRANSFER_LETTER / NEMIS_REPORT / ID_COPY / MEDICAL_CERT / OTHER |
| `title` | varchar(200) | |
| `file_url` | text NOT NULL | CDN/public URL |
| `storage_key` | text | S3/R2 key |
| `content_type` | varchar(100) | MIME type |
| `size_bytes` | bigint | |
| `notes` | varchar(500) | |
| `uploaded_by_user_id` | uuid FK → users | |
| `uploaded_at` | timestamptz | |

### New permissions
| Code | Description |
|------|-------------|
| `students.biodata.read` | Read extended student bio-data |
| `students.biodata.update` | Update extended student bio-data |
| `students.emergency_contacts.read` | Read emergency contacts |
| `students.emergency_contacts.manage` | Create / update / delete emergency contacts |
| `students.documents.read` | Read student documents |
| `students.documents.manage` | Upload / delete student documents |

### API endpoints — `/api/v1/students`
| Method | Path | Permission | Description |
|--------|------|-----------|-------------|
| GET | `/{student_id}` | `students.biodata.read` | Full student profile |
| PATCH | `/{student_id}/biodata` | `students.biodata.update` | Update bio-data |
| GET | `/{student_id}/guardian` | `students.biodata.read` | Guardian list for student |
| PATCH | `/{student_id}/guardian/{parent_id}` | `students.biodata.update` | Update guardian contact info |
| GET | `/{student_id}/emergency-contacts` | `students.emergency_contacts.read` | List emergency contacts |
| POST | `/{student_id}/emergency-contacts` | `students.emergency_contacts.manage` | Add contact |
| PATCH | `/{student_id}/emergency-contacts/{contact_id}` | `students.emergency_contacts.manage` | Update contact |
| DELETE | `/{student_id}/emergency-contacts/{contact_id}` | `students.emergency_contacts.manage` | Delete contact |
| GET | `/{student_id}/documents` | `students.documents.read` | List documents |
| POST | `/{student_id}/documents` | `students.documents.manage` | Register document (URL-based) |
| DELETE | `/{student_id}/documents/{doc_id}` | `students.documents.manage` | Delete document record |

### Files
- `backend/alambic/versions/d4e5f6g7h8i9_extend_student_biodata.py`
- `backend/alambic/versions/e5f6g7h8i9j0_extend_parent_contact_fields.py`
- `backend/alambic/versions/f6g7h8i9j0k1_add_student_emergency_contacts.py`
- `backend/alambic/versions/g7h8i9j0k1l2_add_student_documents.py`
- `backend/alambic/versions/h8i9j0k1l2m3_seed_sis_permissions.py`
- `backend/app/models/student.py` ← new SQLAlchemy model
- `backend/app/models/parent.py` ← new SQLAlchemy model
- `backend/app/api/v1/students/routes.py` ← new router
- `backend/app/api/v1/students/schemas.py` ← Pydantic schemas
- `backend/app/api/v1/router.py` ← register students router
- `backend/tests/test_sis_phase1.py`

---

## Phase 2 — Attendance
**Status:** ✅ Complete — 2026-03-27 · 34/34 tests passing

### What
Full attendance subsystem: class roster management, session-based roll call
(MORNING / AFTERNOON / PERIOD), DRAFT → SUBMITTED → FINALIZED state machine,
correction audit trail, and per-student / per-class reports.

### Migrations
| ID | Description |
|----|-------------|
| `i9j0k1l2m3n4` | Create `core.student_class_enrollments` |
| `j0k1l2m3n4o5` | Create `core.attendance_sessions` + `core.attendance_records` |
| `k1l2m3n4o5p6` | Seed attendance permissions |

### New tables

**`core.student_class_enrollments`** — links a student to a class for a term
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_id` | uuid FK → tenants | |
| `student_id` | uuid FK → students | |
| `class_id` | uuid FK → tenant_classes | |
| `term_id` | uuid FK → tenant_terms | |
| `status` | varchar(30) DEFAULT 'ACTIVE' | ACTIVE / WITHDRAWN / TRANSFERRED |
| `enrolled_at` | timestamptz | |
| `withdrawn_at` | timestamptz | |
| `notes` | varchar(500) | |
| `created_by_user_id` | uuid | |
| UNIQUE | `(tenant_id, student_id, class_id, term_id)` | one enrollment per student-class-term |

**`core.attendance_sessions`** — one session = one roll-call event
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `class_id` | uuid FK → tenant_classes | |
| `term_id` | uuid FK → tenant_terms | |
| `subject_id` | uuid (nullable) | PERIOD sessions only |
| `session_date` | date NOT NULL | |
| `session_type` | varchar(30) | MORNING / AFTERNOON / PERIOD |
| `period_number` | smallint | lesson number (PERIOD only) |
| `status` | varchar(30) | DRAFT → SUBMITTED → FINALIZED |
| `marked_by_user_id` | uuid FK → users | |
| `submitted_at` | timestamptz | |
| `finalized_by_user_id` | uuid FK → users | |
| `finalized_at` | timestamptz | |
| PARTIAL UNIQUE | `(tenant_id, class_id, session_date, session_type)` WHERE type IN ('MORNING','AFTERNOON') | one daily session per class |
| PARTIAL UNIQUE | `(tenant_id, class_id, session_date, session_type, subject_id, period_number)` WHERE type = 'PERIOD' | one period session |

**`core.attendance_records`** — per-student status within a session
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `session_id` | uuid FK → attendance_sessions | |
| `enrollment_id` | uuid FK → student_class_enrollments | |
| `student_id` | uuid FK → students | denormalised for query performance |
| `status` | varchar(30) | PRESENT / ABSENT / LATE / EXCUSED / OFF_GROUNDS |
| `notes` | varchar(500) | |
| `original_status` | varchar(30) | set on first correction |
| `corrected_by_user_id` | uuid | |
| `corrected_at` | timestamptz | |
| UNIQUE | `(session_id, student_id)` | one record per student per session |

### Permissions
| Code | Description | Director | Secretary | Teacher |
|------|-------------|----------|-----------|---------|
| `attendance.view` | View sessions and records | ✓ | ✓ | ✓ |
| `attendance.mark` | Create sessions and record attendance | ✓ | ✓ | ✓ |
| `attendance.correct` | Correct finalized records (with audit) | ✓ | ✓ | |
| `attendance.reports` | Student / class attendance reports | ✓ | ✓ | |
| `attendance.enroll` | Manage class roster | ✓ | ✓ | |

### API endpoints — `/api/v1/attendance`
| Method | Path | Permission | Description |
|--------|------|-----------|-------------|
| GET | `/classes/{class_id}/roster` | `attendance.view` | Enrolled students for class+term |
| POST | `/classes/{class_id}/enroll` | `attendance.enroll` | Enroll student in class/term |
| PATCH | `/classes/{class_id}/roster/{enrollment_id}` | `attendance.enroll` | Withdraw / transfer student |
| GET | `/sessions` | `attendance.view` | List sessions (filter by class/term/date/status) |
| POST | `/sessions` | `attendance.mark` | Create attendance session (starts as DRAFT) |
| GET | `/sessions/{session_id}` | `attendance.view` | Session detail with all records |
| POST | `/sessions/{session_id}/records` | `attendance.mark` | Bulk upsert records for session |
| POST | `/sessions/{session_id}/submit` | `attendance.mark` | DRAFT → SUBMITTED |
| POST | `/sessions/{session_id}/finalize` | `attendance.mark` | SUBMITTED → FINALIZED |
| PATCH | `/sessions/{session_id}/records/{record_id}` | `attendance.correct` | Correct a record (stores audit trail) |
| GET | `/students/{student_id}/summary` | `attendance.reports` | Student attendance summary for term |
| GET | `/classes/{class_id}/report` | `attendance.reports` | Per-student report for whole class |

### Files
- `backend/alambic/versions/i9j0k1l2m3n4_add_student_class_enrollments.py`
- `backend/alambic/versions/j0k1l2m3n4o5_add_attendance_tables.py`
- `backend/alambic/versions/k1l2m3n4o5p6_seed_attendance_permissions.py`
- `backend/app/models/tenant_term.py` ← new ORM model
- `backend/app/models/tenant_class.py` ← new ORM model
- `backend/app/models/attendance.py` ← StudentClassEnrollment, AttendanceSession, AttendanceRecord
- `backend/app/api/v1/attendance/routes.py` ← full API router
- `backend/app/api/v1/attendance/schemas.py` ← Pydantic schemas
- `backend/app/api/v1/router.py` ← register attendance router
- `backend/tests/test_attendance_phase2.py`

---

## Phase 3A — 8-4-4 Report Cards
**Status:** ✅ Complete — 2026-03-27 · 20/20 tests passing

### What
Generate PDF term reports using existing `tenant_exam_marks`. Position in
class, mean score, subject teacher remarks, class teacher comment, principal
comment, attendance summary.

### Migrations
| ID | Description |
|----|-------------|
| `l2m3n4o5p6q7` | Create `core.term_report_remarks` |
| `m3n4o5p6q7r8` | Seed report card permissions |

### New table — `core.term_report_remarks`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `student_enrollment_id` | uuid FK → enrollments | |
| `term_id` | uuid FK → tenant_terms | |
| `class_code` | varchar(80) | |
| `class_teacher_comment` | text | |
| `principal_comment` | text | |
| `conduct` | varchar(30) | EXCELLENT / VERY GOOD / GOOD / SATISFACTORY / UNSATISFACTORY |
| `next_term_begins` | date | |
| `status` | varchar(20) DEFAULT 'DRAFT' | DRAFT / PUBLISHED |
| `published_at` | timestamptz | |
| `published_by_user_id` | uuid FK → users | |
| UNIQUE | `(tenant_id, student_enrollment_id, term_id)` | |

### Permissions
| Code | Description | Director | Secretary | Teacher |
|------|-------------|----------|-----------|---------|
| `reports.view` | View report cards | ✓ | ✓ | ✓ |
| `reports.edit` | Edit remarks & comments | ✓ | ✓ | |
| `reports.publish` | Publish class report cards | ✓ | | |

### API endpoints — `/api/v1/reports`
| Method | Path | Permission | Description |
|--------|------|-----------|-------------|
| GET | `/8-4-4/classes/{class_code}/term/{term_id}` | `reports.view` | Class results overview (ranked) |
| GET | `/8-4-4/enrollments/{enrollment_id}/term/{term_id}` | `reports.view` | Full report card JSON |
| PUT | `/8-4-4/enrollments/{enrollment_id}/term/{term_id}/remarks` | `reports.edit` | Upsert remarks |
| POST | `/8-4-4/classes/{class_code}/term/{term_id}/publish` | `reports.publish` | Publish all DRAFT remarks |
| GET | `/8-4-4/enrollments/{enrollment_id}/term/{term_id}/pdf` | `reports.view` | PDF download |

### Files
- `backend/alambic/versions/l2m3n4o5p6q7_add_report_card_remarks_table.py`
- `backend/alambic/versions/m3n4o5p6q7r8_seed_report_card_permissions.py`
- `backend/app/models/report_card.py` ← TermReportRemarks ORM model
- `backend/app/models/exam.py` ← TenantSubject, TenantExam, TenantExamMark ORM models
- `backend/app/utils/report_card_pdf.py` ← pure-Python A4 PDF generator
- `backend/app/api/v1/reports/routes.py` ← full API router
- `backend/app/api/v1/reports/schemas.py` ← Pydantic schemas
- `backend/app/api/v1/router.py` ← register reports router
- `backend/tests/test_reports_phase3a.py`

---

## Phase 3B — CBC Assessments
**Status:** ⬜ Pending

### What
Full CBC schema: learning areas → strands → sub-strands → per-learner
performance level per term. Formative assessment entry for teachers.
Individual learner PDF reports.

### Planned schema
- `core.cbc_learning_areas`
- `core.cbc_strands`
- `core.cbc_sub_strands`
- `core.cbc_learner_assessments` — enrollment_id + sub_strand_id + term_id + performance_level

### Performance levels
`BE` (Below Expectation) · `AE` (Approaching Expectation) ·
`ME` (Meeting Expectation) · `EE` (Exceeding Expectation)

---

## Phase 4 — Discipline
**Status:** ⬜ Pending

### Planned schema
`core.discipline_incidents` — enrollment_id, incident_date, category,
description, action_taken, recorded_by, resolved_at

---

## Phase 5 — Communication Hub
**Status:** ⬜ Pending

### What
Bulk SMS (Africa's Talking) + email (SendGrid/Postmark) on top of existing
in-app notification system. Single `notification_dispatch` service so
templates stay decoupled from providers.

---

## Phase 6 — Parent Portal
**Status:** ⬜ Pending

### What
Read-only tenant portal for parents: fee balance, exam results, attendance,
notices. Uses existing `core.parents.user_id` for auth. Ownership enforced
via `core.parent_students` junction.

Frontend route: `/parent/*`

---

## Phase 7 — Transport (Future)
**Status:** ⬜ Deferred

Real-time GPS tracking requires a mobile driver app, GPS hardware integration,
and WebSockets. Treat as a paid add-on module after Phases 1–6 are stable.

---

## Cross-Cutting Decisions (Made Upfront)

| Concern | Decision |
|---------|----------|
| File storage | S3/R2 — extend student-photo pattern to all docs |
| PDF generation | Jinja2 + WeasyPrint (already used for receipts/invoices) |
| Background jobs | Celery + Redis (Redis already running) — wire before Phase 5 |
| SMS provider | Africa's Talking (Kenya-native, simple REST API) |
| Email provider | Postmark or SendGrid |
| Permissions | Seed per-phase in migrations, assign to roles immediately |

---

## Phase Completion Log

| Phase | Completed | Notes |
|-------|-----------|-------|
| 0 — Curriculum type | 2026-03-27 | 10/10 tests |
| 1 — SIS depth | 2026-03-27 | 36/36 tests |
| 2 — Attendance | 2026-03-27 | 34/34 tests |
| 3A — 8-4-4 reports | — | |
| 3B — CBC assessments | — | |
| 4 — Discipline | — | |
| 5 — Communication | — | |
| 6 — Parent portal | — | |
