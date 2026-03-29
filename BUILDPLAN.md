# School Management System — Build Plan

> Last updated: 2026-03-29
> Track progress here after each phase is completed. Mark phases ✅ when done.

---

## Architecture Layers

```
Layer 5: Offline / LAN  On-premise Docker deployment · PWA attendance fallback
Layer 4: Outputs        Reports · Transcripts · Parent Portal · Communication Hub
Layer 3: Academic Logic CBC · 8-4-4 · Attendance · Discipline
Layer 2: People & Setup SIS depth · Guardian contacts · Documents
Layer 1: Foundation     Curriculum type · Extended student record  ← start
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
| `d5e6f7g8h9i0` | Create `core.parents` + `core.parent_students` base tables |
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
- `backend/alambic/versions/d5e6f7g8h9i0_create_core_parents_base_tables.py`
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
| PARTIAL UNIQUE | `(tenant_id, class_id, session_date, session_type)` WHERE type IN ('MORNING','AFTERNOON') | |
| PARTIAL UNIQUE | `(tenant_id, class_id, session_date, session_type, subject_id, period_number)` WHERE type = 'PERIOD' | |

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
| UNIQUE | `(session_id, student_id)` | |

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
- `backend/app/models/tenant_term.py`
- `backend/app/models/tenant_class.py`
- `backend/app/models/attendance.py`
- `backend/app/api/v1/attendance/routes.py`
- `backend/app/api/v1/attendance/schemas.py`
- `backend/app/api/v1/router.py`
- `backend/tests/test_attendance_phase2.py`

---

## Phase 3A — 8-4-4 Report Cards

**Status:** ✅ Complete — 2026-03-29 · 20/20 tests passing

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
- `backend/app/models/report_card.py`
- `backend/app/models/exam.py`
- `backend/app/utils/report_card_pdf.py`
- `backend/app/api/v1/reports/routes.py`
- `backend/app/api/v1/reports/schemas.py`
- `backend/tests/test_reports_phase3a.py`

---

## Phase 3B — CBC Assessments

**Status:** ⬜ Pending

### What

Full CBC schema for Kenyan curriculum (Grades 1–9): learning areas → strands →
sub-strands → per-learner performance level per term. Tenant-configurable
curriculum structure with sensible defaults seeded on creation.
Individual learner PDF progress report.

### Migrations

| ID | Description |
|----|-------------|
| `n4o5p6q7r8s9` | Create `core.cbc_learning_areas`, `core.cbc_strands`, `core.cbc_sub_strands` |
| `o5p6q7r8s9t0` | Create `core.cbc_assessments` |
| `p6q7r8s9t0u1` | Seed CBC permissions |

### New tables

**`core.cbc_learning_areas`** — top-level subject equivalent

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `name` | varchar(120) NOT NULL | e.g. "English Language" |
| `code` | varchar(30) NOT NULL | e.g. "ENG" |
| `grade_band` | varchar(30) | LOWER_PRIMARY / UPPER_PRIMARY / JUNIOR_SECONDARY |
| `display_order` | smallint DEFAULT 0 | UI ordering |
| `is_active` | boolean DEFAULT true | |
| `created_at` | timestamptz | |
| UNIQUE | `(tenant_id, code, grade_band)` | |

**`core.cbc_strands`** — major topic within a learning area

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `learning_area_id` | uuid FK → cbc_learning_areas | |
| `name` | varchar(200) NOT NULL | |
| `code` | varchar(30) NOT NULL | |
| `display_order` | smallint DEFAULT 0 | |
| `is_active` | boolean DEFAULT true | |
| UNIQUE | `(tenant_id, learning_area_id, code)` | |

**`core.cbc_sub_strands`** — specific assessable skill within a strand

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `strand_id` | uuid FK → cbc_strands | |
| `name` | varchar(200) NOT NULL | |
| `code` | varchar(30) NOT NULL | |
| `display_order` | smallint DEFAULT 0 | |
| `is_active` | boolean DEFAULT true | |
| UNIQUE | `(tenant_id, strand_id, code)` | |

**`core.cbc_assessments`** — one row per learner per sub-strand per term

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `enrollment_id` | uuid FK → student_class_enrollments | |
| `student_id` | uuid FK → students | denormalised for query speed |
| `sub_strand_id` | uuid FK → cbc_sub_strands | |
| `term_id` | uuid FK → tenant_terms | |
| `performance_level` | varchar(2) NOT NULL | BE / AE / ME / EE |
| `teacher_observations` | text | optional free-text |
| `assessed_by_user_id` | uuid FK → users | |
| `assessed_at` | timestamptz | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| UNIQUE | `(tenant_id, enrollment_id, sub_strand_id, term_id)` | one entry per learner per sub-strand per term |

### Performance levels

| Code | Label | Meaning |
|------|-------|---------|
| `BE` | Below Expectation | Learner has not yet met the minimum standard |
| `AE` | Approaching Expectation | Learner is on track but not yet at standard |
| `ME` | Meeting Expectation | Learner meets the expected standard |
| `EE` | Exceeding Expectation | Learner demonstrates mastery beyond expectation |

### Seeded default structure (per grade band, applied at tenant creation)

Lower Primary (Grades 1–3):
- English Activities, Kiswahili Activities, Mathematical Activities,
  Environmental Activities, Creative Activities, Religious Education

Upper Primary (Grades 4–6):
- English Language, Kiswahili Language, Mathematics, Integrated Science,
  Social Studies, Agriculture & Nutrition, Creative Arts & Sports,
  Religious Education, Pre-Technical Studies

Junior Secondary (Grades 7–9):
- English, Kiswahili, Mathematics, Integrated Science, Social Studies,
  Agriculture, Pre-Technical & Pre-Career Education, Creative Arts & Sports,
  Religious Education, Life Skills Education

### Permissions

| Code | Description | Director | Secretary | Teacher |
|------|-------------|----------|-----------|---------|
| `cbc.curriculum.manage` | Create/edit learning areas, strands, sub-strands | ✓ | | |
| `cbc.curriculum.view` | View curriculum structure | ✓ | ✓ | ✓ |
| `cbc.assessments.enter` | Enter / update performance levels | ✓ | ✓ | ✓ |
| `cbc.assessments.view` | View learner assessments | ✓ | ✓ | ✓ |
| `cbc.reports.generate` | Download learner PDF progress report | ✓ | ✓ | |

### API endpoints — `/api/v1/cbc`

| Method | Path | Permission | Description |
|--------|------|-----------|-------------|
| GET | `/curriculum` | `cbc.curriculum.view` | Full learning area → strand → sub-strand tree |
| POST | `/curriculum/learning-areas` | `cbc.curriculum.manage` | Create learning area |
| PATCH | `/curriculum/learning-areas/{id}` | `cbc.curriculum.manage` | Update learning area |
| POST | `/curriculum/strands` | `cbc.curriculum.manage` | Create strand |
| PATCH | `/curriculum/strands/{id}` | `cbc.curriculum.manage` | Update strand |
| POST | `/curriculum/sub-strands` | `cbc.curriculum.manage` | Create sub-strand |
| PATCH | `/curriculum/sub-strands/{id}` | `cbc.curriculum.manage` | Update sub-strand |
| GET | `/assessments` | `cbc.assessments.view` | List assessments (filter: class_id/enrollment_id/term_id) |
| PUT | `/assessments` | `cbc.assessments.enter` | Bulk upsert — one call per learner per term |
| GET | `/enrollments/{enrollment_id}/term/{term_id}/report` | `cbc.assessments.view` | Full report JSON |
| GET | `/enrollments/{enrollment_id}/term/{term_id}/pdf` | `cbc.reports.generate` | PDF progress report download |

### Files

- `backend/alambic/versions/n4o5p6q7r8s9_add_cbc_curriculum_structure.py`
- `backend/alambic/versions/o5p6q7r8s9t0_add_cbc_assessments.py`
- `backend/alambic/versions/p6q7r8s9t0u1_seed_cbc_permissions.py`
- `backend/app/models/cbc.py` ← CbcLearningArea, CbcStrand, CbcSubStrand, CbcAssessment ORM models
- `backend/app/utils/cbc_report_pdf.py` ← A4 PDF progress report generator
- `backend/app/api/v1/cbc/routes.py` ← full API router
- `backend/app/api/v1/cbc/schemas.py` ← Pydantic schemas
- `backend/app/api/v1/router.py` ← register cbc router
- `backend/tests/test_cbc_phase3b.py`

### Tests (target: 25+)

- Curriculum structure CRUD (director only for manage, all roles for view)
- Bulk upsert assessments — create, then update same record
- Invalid performance_level rejected (400)
- `GET /assessments` filtered by enrollment_id + term_id returns correct rows
- PDF endpoint returns `application/pdf` with 200
- Permission enforcement per role

---

## Phase 4 — Discipline

**Status:** ⬜ Pending

### What

Full discipline incident tracking: log incidents with category and severity,
record actions taken, manage resolution lifecycle, suspension tracking,
and per-student discipline history report.

### Migrations

| ID | Description |
|----|-------------|
| `q7r8s9t0u1v2` | Create `core.discipline_incidents` + `core.discipline_sanctions` |
| `r8s9t0u1v2w3` | Seed discipline permissions |

### New tables

**`core.discipline_incidents`** — one row per recorded incident

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `student_id` | uuid FK → students | |
| `enrollment_id` | uuid FK → student_class_enrollments (nullable) | |
| `incident_date` | date NOT NULL | |
| `category` | varchar(40) | MISCONDUCT / ABSENTEEISM / VIOLENCE / PROPERTY_DAMAGE / SUBSTANCE_ABUSE / BULLYING / OTHER |
| `severity` | varchar(20) | MINOR / MODERATE / MAJOR / CRITICAL |
| `description` | text NOT NULL | Full account of the incident |
| `action_taken` | text | Immediate action at time of incident |
| `status` | varchar(20) DEFAULT 'OPEN' | OPEN / UNDER_REVIEW / RESOLVED / ESCALATED |
| `recorded_by_user_id` | uuid FK → users | |
| `reviewed_by_user_id` | uuid FK → users (nullable) | |
| `resolved_at` | timestamptz | |
| `resolution_notes` | text | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**`core.discipline_sanctions`** — formal sanction applied for an incident

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `incident_id` | uuid FK → discipline_incidents | |
| `sanction_type` | varchar(40) | VERBAL_WARNING / WRITTEN_WARNING / DETENTION / SUSPENSION / EXPULSION / COMMUNITY_SERVICE / PARENT_SUMMONS / OTHER |
| `duration_days` | smallint (nullable) | for SUSPENSION |
| `start_date` | date (nullable) | |
| `end_date` | date (nullable) | |
| `notes` | varchar(500) | |
| `issued_by_user_id` | uuid FK → users | |
| `created_at` | timestamptz | |

### Permissions

| Code | Description | Director | Secretary | Principal | Teacher |
|------|-------------|----------|-----------|-----------|---------|
| `discipline.view` | View incidents and sanctions | ✓ | ✓ | ✓ | own class only |
| `discipline.record` | Log new incidents | ✓ | ✓ | ✓ | ✓ |
| `discipline.manage` | Update / review / resolve incidents | ✓ | | ✓ | |
| `discipline.sanction` | Issue formal sanctions | ✓ | | ✓ | |
| `discipline.reports` | View per-student discipline history | ✓ | ✓ | ✓ | |

### API endpoints — `/api/v1/discipline`

| Method | Path | Permission | Description |
|--------|------|-----------|-------------|
| GET | `/incidents` | `discipline.view` | List incidents (filter: student_id/status/category/date range) |
| POST | `/incidents` | `discipline.record` | Log new incident |
| GET | `/incidents/{id}` | `discipline.view` | Incident detail with sanctions |
| PATCH | `/incidents/{id}` | `discipline.manage` | Update description / status / resolution |
| POST | `/incidents/{id}/sanctions` | `discipline.sanction` | Add formal sanction |
| PATCH | `/incidents/{id}/sanctions/{sanction_id}` | `discipline.sanction` | Update sanction |
| DELETE | `/incidents/{id}/sanctions/{sanction_id}` | `discipline.sanction` | Remove sanction |
| GET | `/students/{student_id}/history` | `discipline.reports` | Full discipline history for student |
| GET | `/students/{student_id}/summary` | `discipline.reports` | Counts by category/severity for a term |

### Files

- `backend/alambic/versions/q7r8s9t0u1v2_add_discipline_tables.py`
- `backend/alambic/versions/r8s9t0u1v2w3_seed_discipline_permissions.py`
- `backend/app/models/discipline.py` ← DisciplineIncident, DisciplineSanction ORM models
- `backend/app/api/v1/discipline/routes.py` ← full API router
- `backend/app/api/v1/discipline/schemas.py` ← Pydantic schemas
- `backend/app/api/v1/router.py` ← register discipline router
- `backend/tests/test_discipline_phase4.py`

### Tests (target: 20+)

- Log incident (all recording roles)
- PATCH incident updates status correctly (OPEN → UNDER_REVIEW → RESOLVED)
- Add/remove sanction
- Status transition guard: cannot re-open RESOLVED without manage permission
- Per-student history returns all incidents sorted by date desc
- Summary counts correct by category
- Permission enforcement per role

---

## Phase 5 — Communication Hub

**Status:** ⬜ Pending

### Prerequisites

Celery + Redis must be wired before this phase. Redis is already running.
Wire Celery as a named service in `docker-compose.prod.yml` before Phase 5 starts.

### What

Bulk SMS (Africa's Talking) + transactional email (Postmark) on top of the
existing in-app notification system. Reusable templates, provider-agnostic
dispatch service, delivery status tracking, and retry on failure.

### Migrations

| ID | Description |
|----|-------------|
| `s9t0u1v2w3x4` | Create `core.notification_templates` + `core.notification_dispatches` |
| `t0u1v2w3x4y5` | Seed communication permissions |

### Celery setup (infrastructure — before migrations)

Add to `docker-compose.prod.yml`:

```yaml
celery-worker:
  image: ${BACKEND_IMAGE}
  command: ["celery", "-A", "app.celery_app", "worker", "--loglevel=info", "--concurrency=2"]
  env_file: [./.env]
  environment:
    DATABASE_URL: ${DOCKER_DATABASE_URL}
    REDIS_URL: ${REDIS_URL:-redis://redis:6379/0}
    REDIS_PASSWORD: ${REDIS_PASSWORD}
  depends_on:
    postgres: {condition: service_healthy}
    redis: {condition: service_healthy}
  restart: unless-stopped
  cpus: "0.50"
  mem_limit: "512m"
  networks: [backend-net]
```

Add `backend/app/celery_app.py` — Celery application factory using Redis as broker + result backend.

### New tables

**`core.notification_templates`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `name` | varchar(120) NOT NULL | e.g. "Fee reminder" |
| `category` | varchar(40) | FEE_REMINDER / REPORT_READY / ATTENDANCE_ALERT / GENERAL / CUSTOM |
| `subject` | varchar(200) | Email subject line |
| `body_sms` | text | SMS body (max 160 chars recommended) |
| `body_email` | text | HTML/plain email body |
| `variables` | jsonb DEFAULT '[]' | list of placeholder names e.g. ["student_name","balance"] |
| `is_active` | boolean DEFAULT true | |
| `created_by_user_id` | uuid FK → users | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| UNIQUE | `(tenant_id, name)` | |

**`core.notification_dispatches`** — immutable log of every send attempt

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_id` | uuid FK | |
| `template_id` | uuid FK → notification_templates (nullable) | null for ad-hoc sends |
| `channel` | varchar(10) | SMS / EMAIL / PUSH |
| `recipient_user_id` | uuid FK → users (nullable) | |
| `recipient_phone` | varchar(50) | for SMS |
| `recipient_email` | varchar(200) | for EMAIL |
| `subject` | varchar(200) | rendered subject |
| `body` | text | rendered body (after variable substitution) |
| `status` | varchar(20) DEFAULT 'QUEUED' | QUEUED / SENDING / SENT / FAILED / CANCELLED |
| `provider` | varchar(40) | AFRICAS_TALKING / POSTMARK / INTERNAL |
| `provider_message_id` | varchar(200) | provider's message reference |
| `sent_at` | timestamptz | |
| `error_message` | text | set on FAILED |
| `retry_count` | smallint DEFAULT 0 | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### Permissions

| Code | Description | Director | Secretary |
|------|-------------|----------|-----------|
| `comms.templates.manage` | Create / edit notification templates | ✓ | |
| `comms.templates.view` | View templates | ✓ | ✓ |
| `comms.send` | Compose and send notifications | ✓ | ✓ |
| `comms.history.view` | View dispatch log | ✓ | ✓ |

### API endpoints — `/api/v1/communications`

| Method | Path | Permission | Description |
|--------|------|-----------|-------------|
| GET | `/templates` | `comms.templates.view` | List templates |
| POST | `/templates` | `comms.templates.manage` | Create template |
| PATCH | `/templates/{id}` | `comms.templates.manage` | Update template |
| DELETE | `/templates/{id}` | `comms.templates.manage` | Soft-delete template |
| POST | `/send` | `comms.send` | Compose and enqueue notification (bulk or single) |
| GET | `/dispatches` | `comms.history.view` | Dispatch log (filter: status/channel/date) |
| GET | `/dispatches/{id}` | `comms.history.view` | Single dispatch detail |

### `/send` request body

```json
{
  "channel": "SMS",
  "template_id": "uuid (optional)",
  "recipient_type": "ALL_PARENTS | CLASS | INDIVIDUAL",
  "class_id": "uuid (if CLASS)",
  "user_ids": ["uuid", ...],
  "subject": "Fee reminder (email only)",
  "body": "Dear {student_name}, your fee balance is KES {balance}.",
  "variables": { "student_name": "...", "balance": "..." }
}
```

Celery task: resolves recipients → renders template per recipient → writes
dispatch rows (QUEUED) → calls provider API → updates status to SENT/FAILED.
Celery retries up to 3× with exponential backoff on provider errors.

### Files

- `backend/alambic/versions/s9t0u1v2w3x4_add_notification_tables.py`
- `backend/alambic/versions/t0u1v2w3x4y5_seed_comms_permissions.py`
- `backend/app/celery_app.py` ← Celery factory
- `backend/app/tasks/notifications.py` ← Celery task: send_notification
- `backend/app/services/sms.py` ← Africa's Talking client wrapper
- `backend/app/services/email.py` ← Postmark client wrapper
- `backend/app/models/notification.py` ← NotificationTemplate, NotificationDispatch ORM
- `backend/app/api/v1/communications/routes.py`
- `backend/app/api/v1/communications/schemas.py`
- `backend/app/api/v1/router.py` ← register communications router
- `docker-compose.prod.yml` ← add celery-worker service
- `backend/tests/test_comms_phase5.py`

### Tests (target: 20+)

- Template CRUD with permission enforcement
- Send SMS: dispatch row created with QUEUED status
- Send EMAIL: dispatch row created, subject set
- Bulk send to CLASS: one dispatch row per recipient
- Invalid channel rejected (400)
- `GET /dispatches` returns correct rows filtered by status
- Celery task integration test (mock provider calls)

---

## Phase 6 — Parent Portal

**Status:** ⬜ Pending

### What

Read-only self-service portal for parents/guardians. Authenticated via the
existing login system (role = PARENT). Ownership enforced via
`core.parent_students` junction — a parent can only see their linked children.

No new database tables required. Uses existing: students, parents,
parent_students, finance tables, exam marks, attendance_records,
term_report_remarks, discipline_incidents.

### New permissions

| Code | Description |
|------|-------------|
| `parent.portal.access` | Access the parent portal (all PARENT role users get this) |

### API endpoints — `/api/v1/parent`

All endpoints enforce: authenticated user must have PARENT role AND
`core.parent_students` must link them to the requested `student_id`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/children` | List all children linked to this parent |
| GET | `/children/{student_id}/profile` | Student bio-data (read-only) |
| GET | `/children/{student_id}/fees` | Fee balance + payment history |
| GET | `/children/{student_id}/attendance/summary` | Attendance % by term |
| GET | `/children/{student_id}/results` | Exam marks per subject per term |
| GET | `/children/{student_id}/report-card/{term_id}` | 8-4-4 or CBC report card JSON |
| GET | `/children/{student_id}/report-card/{term_id}/pdf` | Report card PDF download |
| GET | `/children/{student_id}/discipline` | Discipline incident history (public fields only) |
| GET | `/notices` | Tenant-wide notices visible to parents |

### Frontend routes (Next.js)

All under `/parent/*` — separate layout from staff routes.

| Route | Description |
|-------|-------------|
| `/parent` | Dashboard: children list with quick stats |
| `/parent/children/{id}` | Child profile overview |
| `/parent/children/{id}/fees` | Fee balance + receipt download |
| `/parent/children/{id}/attendance` | Attendance chart and session history |
| `/parent/children/{id}/results` | Marks table per term |
| `/parent/children/{id}/report-card` | Report card view + PDF download |
| `/parent/children/{id}/discipline` | Discipline incidents (read-only) |

### Files

- `backend/app/api/v1/parent/routes.py` ← full API router
- `backend/app/api/v1/parent/schemas.py` ← output-only Pydantic schemas
- `backend/app/api/v1/router.py` ← register parent router
- `frontend/src/app/(parent)/parent/layout.tsx` ← parent shell (minimal, no staff nav)
- `frontend/src/app/(parent)/parent/page.tsx` ← dashboard
- `frontend/src/app/(parent)/parent/children/[id]/page.tsx`
- `frontend/src/app/(parent)/parent/children/[id]/fees/page.tsx`
- `frontend/src/app/(parent)/parent/children/[id]/attendance/page.tsx`
- `frontend/src/app/(parent)/parent/children/[id]/results/page.tsx`
- `frontend/src/app/(parent)/parent/children/[id]/report-card/page.tsx`
- `frontend/src/app/(parent)/parent/children/[id]/discipline/page.tsx`
- `backend/tests/test_parent_portal_phase6.py`

### Tests (target: 20+)

- Parent can list only their own linked children (not other parents' children)
- Fee balance correct for each child
- Attendance summary returns correct percentage
- Report card PDF returns `application/pdf`
- Parent cannot access another parent's child (403)
- PARENT role cannot call staff-only endpoints (403)
- Unauthenticated request returns 401

---

## Phase 7 — Transport (Future)

**Status:** ⬜ Deferred

Real-time GPS tracking requires a mobile driver app, GPS hardware integration,
and WebSockets. Treat as a paid add-on module after Phases 1–6 are stable.

---

## Phase 8 — Offline / LAN Deployment

**Status:** ⬜ Pending (after Phase 6)

### What

Allow the entire system to operate inside a school's local area network
with no internet dependency. Internet-dependent features (SMS, email) queue
in Redis and flush automatically when internet becomes available.

### Architecture

```
School LAN (192.168.x.x)
┌──────────────────────────────────────────────────────┐
│  Local server (mini PC / NUC / repurposed workstation)│
│  docker-compose.prod.yml — identical to cloud         │
│  nginx  →  frontend (Next.js)  →  backend (FastAPI)  │
│  postgres + redis + celery-worker                    │
└──────────────────────────────────────────────────────┘
        │  school WiFi
   Staff devices (any browser, any OS)
        │  (optional) internet modem
   Celery flushes SMS/email queue when internet arrives
```

### Steps

1. **LAN nginx config** — add `server_name _` catch-all so any LAN hostname works.
   Document static IP assignment on local router.

2. **Offline-first image delivery** — `docker compose pull` (or load from USB
   tarball for schools with no internet) + `docker compose up -d`.
   CI publishes `ghcr.io` images; school pulls on demand.

3. **Automated local backup** — cron job on the server:
   `pg_dump | gzip > /backups/school_$(date +%Y%m%d).sql.gz`
   Rotate: keep 30 days locally. Optional: rsync to USB or cloud when internet available.

4. **PWA attendance fallback** (optional, after LAN setup) — `next-pwa` / Workbox
   service worker caches the attendance marking UI. Teachers mark offline;
   mutation queue in IndexedDB flushes to LAN server on reconnect.
   Scope: attendance sessions only (bounded conflict surface).

### Files

- `nginx/templates/default.conf.template` ← add `server_name _;` catch-all
- `scripts/backup.sh` ← pg_dump rotation script
- `scripts/deploy-local.sh` ← `docker compose pull && up -d` wrapper
- `docs/lan-deployment.md` ← setup guide for school IT staff
- `frontend/next.config.js` ← add `next-pwa` config (PWA step, optional)
- `frontend/src/lib/sw-attendance-queue.ts` ← IndexedDB mutation queue (PWA step)

---

## Cross-Cutting Decisions (Made Upfront)

| Concern | Decision |
|---------|----------|
| File storage | Named Docker volume `backend_storage` for local; S3/R2 for cloud |
| PDF generation | Pure-Python (reportlab/fpdf2) — no WeasyPrint binary dependency |
| Background jobs | Celery + Redis — wire before Phase 5; Redis already running |
| SMS provider | Africa's Talking (Kenya-native, simple REST API) |
| Email provider | Postmark (transactional) |
| Permissions | Seed per-phase in migrations, assign to roles immediately |
| Migration safety | All `CREATE TABLE` migrations use `IF NOT EXISTS` guard |
| Migration CI | `docker compose up db-migrate` (foreground) — errors are visible in CI logs |
| Auth | Cookie-based sessions; tenant context stored in localStorage (mode/slug/tenantId) |
| Password fields | All password inputs use `PasswordInput` component (Eye/EyeOff toggle) |

---

## Module Summary (Built vs Planned)

| Module | Backend | Frontend | Tests |
|--------|---------|----------|-------|
| Auth / Tenants / SAAS | ✅ | ✅ | ✅ |
| Finance (fees, payments, receipts, invoices) | ✅ | ✅ | ✅ |
| Settings (badge, school identity, passwords) | ✅ | ✅ | — |
| SIS — Student biodata + guardians + docs | ✅ | ✅ | ✅ 36/36 |
| Attendance | ✅ | ✅ | ✅ 34/34 |
| 8-4-4 Report Cards | ✅ | ✅ | ✅ 20/20 |
| CBC Assessments | ⬜ | ⬜ | ⬜ |
| Discipline | ⬜ | ⬜ | ⬜ |
| Communication Hub | ⬜ | ⬜ | ⬜ |
| Parent Portal | ⬜ | ⬜ | ⬜ |
| Offline / LAN | ⬜ | — | — |

---

## Phase Completion Log

| Phase | Completed | Notes |
|-------|-----------|-------|
| 0 — Curriculum type | 2026-03-27 | 10/10 tests |
| 1 — SIS depth | 2026-03-27 | 36/36 tests |
| 2 — Attendance | 2026-03-27 | 34/34 tests |
| 3A — 8-4-4 reports | 2026-03-29 | 20/20 tests |
| 3B — CBC assessments | — | |
| 4 — Discipline | — | |
| 5 — Communication | — | |
| 6 — Parent portal | — | |
| 8 — Offline / LAN | — | |
