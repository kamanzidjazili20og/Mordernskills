// ============================================================
// Database setup.
// - supabase driver (default): tables/views/seeds/storage buckets
//   all live in supabase/Schrema.sql (paste once in the Supabase
//   SQL Editor). This file only ensures the admin account exists
//   at runtime so ADMIN_EMAIL / ADMIN_PASSWORD env vars stay
//   authoritative.
// - mysql driver: legacy auto-setup (DDL + demo seeds) kept for
//   deployments that set DB_DRIVER=mysql.
// Idempotent — safe to run on every server start.
// ============================================================
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { driver, supabase, getDbConfig } = require('./config/db');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@123';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'misigaroissa2@gmail.com';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';

// A password printed to stdout ends up in Render/Railway/Fly log
// viewers, in `docker logs`, and in any log shipper the project is
// wired to. The admin password used to be echoed on every single boot
// in three separate messages, so anyone with read access to the logs
// could sign in. Only the account name is ever logged now.
if (!process.env.ADMIN_PASSWORD) {
    console.warn('[init] ADMIN_PASSWORD is not set — falling back to the default "Admin@123". Set it before exposing this deployment.');
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ------------------------------------------------------------
// SUPABASE MODE
// ------------------------------------------------------------
async function ensureAdminSupabase() {
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

    const { data: existing } = await supabase
        .from('users')
        .select('id')
        .eq('email', ADMIN_EMAIL)
        .maybeSingle();

    if (existing) {
        await supabase
            .from('users')
            .update({
                username: ADMIN_USERNAME,
                password_hash: passwordHash,
                full_name: 'Admin User',
                role: 'admin',
                is_active: true
            })
            .eq('id', existing.id);
            console.log('  ✓ Admin credentials synced (' + ADMIN_EMAIL + ')');
        return;
    }

    const { data: byUsername } = await supabase
        .from('users')
        .select('id')
        .eq('username', ADMIN_USERNAME)
        .maybeSingle();

    if (byUsername) {
        await supabase
            .from('users')
            .update({
                email: ADMIN_EMAIL,
                password_hash: passwordHash,
                full_name: 'Admin User',
                role: 'admin',
                is_active: true
            })
            .eq('id', byUsername.id);
            console.log('  ✓ Admin credentials synced (' + ADMIN_EMAIL + ')');
        return;
    }

    const { error: insertError } = await supabase
        .from('users')
        .insert({
            username: ADMIN_USERNAME,
            email: ADMIN_EMAIL,
            password_hash: passwordHash,
            full_name: 'Admin User',
            role: 'admin',
            is_active: true
        });
    if (insertError) throw insertError;
        console.log('  ✓ Admin user created (' + ADMIN_EMAIL + ')');
}

async function initSupabase() {
    console.log('Supabase database mode — tables/views/buckets are applied via supabase/Schrema.sql.');
    try {
        // Connectivity probe: fails gracefully if Schrema.sql hasn't been run yet.
        const { error } = await supabase.from('users').select('id').limit(1);
        if (error) {
            if (error.code === '42P01' || /does not exist/i.test(error.message || '')) {
                console.warn('  ⚠ users table missing — paste supabase/Schrema.sql into the Supabase SQL Editor first.');
            } else {
                console.warn('  ⚠ Supabase connectivity issue:', error.message);
            }
        } else {
            await ensureAdminSupabase();
            const { error: catErr } = await supabase.from('categories').select('id').limit(1);
            if (catErr) {
                console.warn('  ⚠ categories table missing — paste supabase/Schrema.sql into the Supabase SQL Editor.');
            }
        }
    } catch (err) {
        console.error('Supabase setup check failed:', err.message);
    }
}

// ------------------------------------------------------------
// MYSQL MODE (legacy)
// ------------------------------------------------------------
async function ensureDatabase() {
    const mysql = require('mysql2/promise');
    const cfg = getDbConfig();
    const dbName = cfg.database;

    let lastErr;
    for (let attempt = 1; attempt <= 10; attempt++) {
        let conn;
        try {
            conn = await mysql.createConnection({
                host: cfg.host,
                port: cfg.port,
                user: cfg.user,
                password: cfg.password,
                connectTimeout: 10000
            });
            await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
            console.log(`  ✓ Database '${dbName}' ready (${cfg.host}:${cfg.port})`);
            return;
        } catch (err) {
            lastErr = err;
            console.error(`  ⚠ DB connection attempt ${attempt}/10 failed: ${err.message}`);
            if (conn) await conn.end().catch(() => {});
        }
        if (attempt < 10) await sleep(5000);
    }
    throw lastErr || new Error('Database connection failed');
}

const CREATE_TABLES = [
    `CREATE TABLE IF NOT EXISTS users (
        id INT PRIMARY KEY AUTO_INCREMENT,
        username VARCHAR(50) NOT NULL UNIQUE,
        email VARCHAR(100) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        role ENUM('admin', 'student') NOT NULL DEFAULT 'student',
        avatar_url VARCHAR(500) DEFAULT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        last_login TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_users_email (email),
        INDEX idx_users_role (role)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS categories (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(50) NOT NULL,
        slug VARCHAR(50) NOT NULL UNIQUE,
        description TEXT DEFAULT NULL,
        icon_class VARCHAR(50) DEFAULT NULL,
        color VARCHAR(20) DEFAULT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_categories_slug (slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS instructors (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(100) NOT NULL UNIQUE,
        bio TEXT DEFAULT NULL,
        avatar_url VARCHAR(500) DEFAULT NULL,
        expertise VARCHAR(255) DEFAULT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_instructors_slug (slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS tags (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(50) NOT NULL,
        slug VARCHAR(50) NOT NULL UNIQUE,
        INDEX idx_tags_slug (slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS lessons (
        id INT PRIMARY KEY AUTO_INCREMENT,
        title VARCHAR(255) NOT NULL,
        slug VARCHAR(255) NOT NULL UNIQUE,
        description TEXT DEFAULT NULL,
        category_id INT DEFAULT NULL,
        instructor_id INT DEFAULT NULL,
        difficulty ENUM('Beginner', 'Intermediate', 'Advanced', 'All Levels') NOT NULL DEFAULT 'All Levels',
        duration_minutes INT DEFAULT NULL,
        video_url VARCHAR(500) DEFAULT NULL,
        video_file_path VARCHAR(500) DEFAULT NULL,
        video_file_size BIGINT DEFAULT NULL,
        thumbnail_url VARCHAR(500) DEFAULT NULL,
        is_published TINYINT(1) NOT NULL DEFAULT 0,
        is_free TINYINT(1) NOT NULL DEFAULT 0,
        is_featured TINYINT(1) NOT NULL DEFAULT 0,
        rating DECIMAL(2,1) NOT NULL DEFAULT 0.0,
        student_count INT NOT NULL DEFAULT 0,
        published_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_lessons_slug (slug),
        INDEX idx_lessons_category (category_id),
        INDEX idx_lessons_instructor (instructor_id),
        INDEX idx_lessons_published (is_published),
        INDEX idx_lessons_featured (is_featured),
        INDEX idx_lessons_difficulty (difficulty),
        INDEX idx_lessons_created (created_at),
        FULLTEXT INDEX idx_lessons_search (title, description),
        CONSTRAINT fk_lessons_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT fk_lessons_instructor FOREIGN KEY (instructor_id) REFERENCES instructors(id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS lesson_tags (
        lesson_id INT NOT NULL,
        tag_id INT NOT NULL,
        PRIMARY KEY (lesson_id, tag_id),
        CONSTRAINT fk_lesson_tags_lesson FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_lesson_tags_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS enrollments (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        lesson_id INT NOT NULL,
        enrolled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_enrollment (user_id, lesson_id),
        INDEX idx_enrollments_user (user_id),
        INDEX idx_enrollments_lesson (lesson_id),
        CONSTRAINT fk_enrollments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_enrollments_lesson FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS lesson_progress (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        lesson_id INT NOT NULL,
        progress_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00,
        last_watched_position INT NOT NULL DEFAULT 0,
        is_completed TINYINT(1) NOT NULL DEFAULT 0,
        completed_at TIMESTAMP NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_progress (user_id, lesson_id),
        INDEX idx_progress_user (user_id),
        INDEX idx_progress_lesson (lesson_id),
        CONSTRAINT fk_progress_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_progress_lesson FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS contact_messages (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) NOT NULL,
        subject VARCHAR(255) DEFAULT NULL,
        message TEXT NOT NULL,
        is_read TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_messages_read (is_read)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS testimonials (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name_en VARCHAR(100) NOT NULL,
        name_rw VARCHAR(100) NOT NULL,
        role_en VARCHAR(100) NOT NULL,
        role_rw VARCHAR(100) NOT NULL,
        text_en TEXT NOT NULL,
        text_rw TEXT NOT NULL,
        initials VARCHAR(4) NOT NULL,
        rating INT NOT NULL DEFAULT 5,
        sort_order INT NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS user_preferences (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        pref_key VARCHAR(50) NOT NULL,
        pref_value VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_user_pref (user_id, pref_key),
        CONSTRAINT fk_pref_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS payments (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        lesson_id INT DEFAULT NULL,
        access_type ENUM('video','weekly','monthly') DEFAULT NULL,
        transaction_code VARCHAR(50) DEFAULT NULL,
        phone_number VARCHAR(20) NOT NULL,
        amount DECIMAL(10,2) NOT NULL DEFAULT 0,
        status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
        admin_note TEXT DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reviewed_at TIMESTAMP NULL,
        access_expires_at TIMESTAMP NULL,
        INDEX idx_payments_user (user_id),
        INDEX idx_payments_lesson (lesson_id),
        INDEX idx_payments_status (status),
        CONSTRAINT fk_payments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_payments_lesson FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];

async function createTables() {
    const pool = require('./config/db');
    for (const sql of CREATE_TABLES) {
        await pool.query(sql);
    }
}

async function ensureColumn(table, column, definition) {
    const pool = require('./config/db');
    const [[{ c }]] = await pool.query(
        `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    if (c > 0) return;
    await pool.query('ALTER TABLE `' + table + '` ADD COLUMN `' + column + '` ' + definition);
    console.log('  ✓ Added missing column ' + table + '.' + column);
}

async function migrateExistingTables() {
    await ensureColumn('users', 'last_login', 'TIMESTAMP NULL');
    await ensureColumn('users', 'updated_at', "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
    await ensureColumn('users', 'phone_number', 'VARCHAR(20) DEFAULT NULL');
    await ensureColumn('categories', 'sort_order', 'INT NOT NULL DEFAULT 0');
    await ensureColumn('categories', 'is_active', "TINYINT(1) NOT NULL DEFAULT 1");
    await ensureColumn('lessons', 'video_file_path', 'VARCHAR(500) DEFAULT NULL');
    await ensureColumn('lessons', 'video_file_size', 'BIGINT DEFAULT NULL');
    await ensureColumn('lessons', 'is_free', "TINYINT(1) NOT NULL DEFAULT 0");
    await ensureColumn('lessons', 'is_featured', "TINYINT(1) NOT NULL DEFAULT 0");
    await ensureColumn('lessons', 'published_at', 'TIMESTAMP NULL');
    await ensureColumn('lessons', 'price', "DECIMAL(10,2) NOT NULL DEFAULT 0");
    await ensureColumn('payments', 'lesson_id', 'INT DEFAULT NULL');
    await ensureColumn('payments', 'access_type', "ENUM('video','weekly','monthly') DEFAULT NULL");
    await ensureColumn('payments', 'access_expires_at', 'TIMESTAMP NULL');
    await ensureColumn('users', 'is_active', "TINYINT(1) NOT NULL DEFAULT 1");
}

async function ensureAdmin() {
    const pool = require('./config/db');
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const [rows] = await pool.query(
        'SELECT id FROM users WHERE email = ? OR username = ?',
        [ADMIN_EMAIL, ADMIN_USERNAME]
    );
    if (rows.length > 0) {
        await pool.query(
            'UPDATE users SET username = ?, email = ?, password_hash = ?, full_name = ?, role = ?, is_active = 1 WHERE id = ?',
            [ADMIN_USERNAME, ADMIN_EMAIL, passwordHash, 'Admin User', 'admin', rows[0].id]
        );
            console.log('  ✓ Admin credentials synced (' + ADMIN_EMAIL + ')');
        return;
    }
    await pool.query(
        'INSERT INTO users (username, email, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?)',
        [ADMIN_USERNAME, ADMIN_EMAIL, passwordHash, 'Admin User', 'admin']
    );
        console.log('  ✓ Admin user created (' + ADMIN_EMAIL + ')');
}

async function seedIfEmpty(table, insertSql, values) {
    const pool = require('./config/db');
    const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM ' + table);
    if (c > 0) return;
    await pool.query(insertSql, [values]);
    console.log('  ✓ Seeded ' + table);
}

async function seedDemoContent() {
    await seedIfEmpty('categories',
        `INSERT INTO categories (name, slug, description, icon_class, color, sort_order) VALUES ?`,
        [['Tajweed', 'tajweed', 'Menya gusoma Qur\'an mu buryo bukwiye hamwe n\'amategeko ya Tajweed', 'fa-voice', 'gold', 1],
         ['Tafsir', 'tafsir', 'Ubusobanuro bwimbitse bw\'amagambo ya Qur\'an n\'ibyo asobanura', 'fa-book-open', 'green', 2],
         ['Hifz', 'hifz', 'Gahunda itunganijwe yo kwibuka Qur\'an hamwe no gukurikirana isubiramo', 'fa-brain', 'blue', 3],
         ['Arabic', 'arabic', 'Iga Icyarabu cy\'umwimerere kugira ngo usobanukirwe na Qur\'an utizigamye', 'fa-language', 'purple', 4],
         ['Video Course', 'video-course', 'Amafirime yanditswe mu buryo bwuzuye yigishwa n\'abigisha babahanga', 'fa-video', 'rose', 5]]
    );

    await seedIfEmpty('instructors',
        `INSERT INTO instructors (name, slug, bio, expertise) VALUES ?`,
        [['Sheikh Ahmad Al-Misri', 'sheikh-ahmad-al-misri', 'Umusomyi ukomeye wa Qur\'an n\'umwarimu wa Tajweed ufite uburambe bw\'imyaka irenga 15', 'Tajweed, Qiraat'],
         ['Dr. Aminah Al-Arabi', 'dr-aminah-al-arabi', 'Afite PhD mu bya Isilamu, yibanda ku busobanuro bwa Tafsir bwa Qur\'an', 'Tafsir, Amasomo ya Isilamu'],
         ['Hafiz Yusuf Khan', 'hafiz-yusuf-khan', 'Hafiz wemejwe ufite Ijaza muri Hifz n\'uburambe bwinshi mu kwigisha', 'Hifz, Uburyo bwo Kwibuka'],
         ['Ustadh Omar Farooq', 'ustadh-omar-farooq', 'Umunyamabanga mu cyarabu akaba n\'umwarimu w\'amasomo ya Isilamu', 'Imbonerahamwe y\'Icyarabu, Fiqh']]
    );

    await seedIfEmpty('tags',
        `INSERT INTO tags (name, slug) VALUES ?`,
        [['tajweed', 'tajweed'], ['noon-sakinah', 'noon-sakinah'], ['pronunciation', 'pronunciation'],
         ['makharij', 'makharij'], ['sifaat', 'sifaat'], ['tafsir', 'tafsir'], ['al-fatiha', 'al-fatiha'],
         ['al-kahf', 'al-kahf'], ['hifz', 'hifz'], ['memorization', 'memorization'], ['juz-amma', 'juz-amma'],
         ['arabic', 'arabic'], ['grammar', 'grammar'], ['beginner', 'beginner'], ['advanced', 'advanced']]
    );

    await seedIfEmpty('lessons',
        `INSERT INTO lessons (title, slug, description, category_id, instructor_id, difficulty, duration_minutes, video_url, rating, student_count, is_published, is_featured, created_at) VALUES ?`,
        [['Intangiriro ya Makhaarij & Sifaat', 'makhaarij-sifaat', 'Iga aho buri nyuguti y\'Icyarabu ituruka, n\'imiterere iha buri nyuguti ijwi ryaryo ryihariye. Ni intambwe ya mbere nziza ku batangira.', 1, 1, 'Beginner', 28, 'https://www.youtube.com/watch?v=O2wSMWemJDU', 5.0, 234, 1, 1, '2026-07-25 10:00:00'],
         ['Tafsir ya Surah Al-Fatiha', 'surah-al-fatiha-tafsir', 'Ubusobanuro bwimbitse bw\'ibisobanuro n\'inyigisho bya Surah Al-Fatiha, isura ya mbere ya Qur\'an.', 2, 2, 'All Levels', 35, 'https://www.youtube.com/watch?v=0lMkdXrCCrg', 4.9, 567, 1, 1, '2026-07-22 10:00:00'],
         ['Juz Amma — Surah An-Naba', 'juz-amma-surah-an-naba', 'Fata Surah An-Naba ku mutwe hamwe na Tajweed ikwiye ukoresheje uburyo bwacu bwo gusubiramo buhoro buhoro.', 3, 3, 'Beginner', 22, 'https://www.youtube.com/watch?v=oSppMwLcfS0', 4.8, 892, 1, 1, '2026-07-20 10:00:00'],
         ['Insingiro z\'Imbonerahamwe y\'Icyarabu', 'arabic-grammar-essentials', 'Sobanukirwa ibice bitatu by\'ijambo mu cyarabu: amazina, inshinga, n\'utunyegero.', 4, 4, 'Beginner', 42, 'https://www.youtube.com/watch?v=OoVhY3rcXS8', 4.7, 345, 0, 0, '2026-07-18 10:00:00'],
         ['Noon Sakinah & Tanween', 'noon-sakinah-tanween', 'Ubuyobozi bwuzuye bw\'amategeko ya Noon Sakinah na Tanween.', 1, 1, 'Intermediate', 31, 'https://www.youtube.com/watch?v=ALGAanskdXs', 4.9, 178, 0, 0, '2026-07-15 10:00:00'],
         ['Tafsir ya Ayatul Kursi', 'tafsir-ayatul-kursi', 'Menya umurongo ukomeye wa Qur\'an — Ayatul Kursi.', 2, 2, 'All Levels', 25, 'https://www.youtube.com/watch?v=4fvwdWdfEHI', 4.9, 912, 1, 1, '2026-07-12 10:00:00'],
         ['Kwibuka Surah Al-Fatiha', 'al-fatiha-memorization', 'Fata Surah Al-Fatiha ku mutwe hamwe na Tajweed ikwiye ukoresheje uburyo bworoshye bwo gusubiramo.', 3, 3, 'Beginner', 18, 'https://www.youtube.com/watch?v=Ca2nxrD8x-g', 4.8, 423, 1, 0, '2026-07-10 10:00:00'],
         ['Amategeko ya Madd — Inyuguti Zigurwa', 'madd-rules-extended-letters', 'Iga amategeko yose ya Madd — Madd Tabi\'i, Madd Wajib, na Madd Ja\'iz.', 1, 1, 'Advanced', 26, 'https://www.youtube.com/watch?v=iMIHgkkOJco', 4.9, 156, 0, 0, '2026-07-08 10:00:00'],
         ['Ibihe by\'Inshinga z\'Icyarabu', 'arabic-verb-conjugation', 'Sobanukirwa uko inshinga z\'icyarabu zihinduka ibihe byazo — ibyashize, ibiriho, n\'itegeko.', 4, 4, 'Intermediate', 38, 'https://www.youtube.com/watch?v=OoVhY3rcXS8', 4.7, 289, 1, 0, '2026-07-05 10:00:00'],
         ['Juz Tabarak — Surah Al-Mulk', 'juz-tabarak-surah-al-mulk', 'Fata Surah Al-Mulk ku mutwe hamwe na Tajweed ikwiye.', 3, 3, 'Intermediate', 20, 'https://www.youtube.com/watch?v=Ca2nxrD8x-g', 4.8, 312, 0, 0, '2026-07-02 10:00:00'],
         ['Inshuranyo y\'Inyigisho Yose ya Tajweed', 'complete-tajweed-course-overview', 'Inshuranyo y\'inyigisho yacu yuzuye ya Tajweed ikubiyemo amategeko yose akomeye.', 5, 1, 'All Levels', 12, 'https://www.youtube.com/watch?v=iMIHgkkOJco', 5.0, 1250, 1, 0, '2026-06-28 10:00:00'],
         ['Tafsir ya Surah Yaseen', 'tafsir-of-surah-yaseen', 'Ubusobanuro burambuye bwa Surah Yaseen — umutima wa Qur\'an.', 2, 2, 'Advanced', 45, 'https://www.youtube.com/watch?v=MzijGS3Zo_0', 4.9, 734, 0, 0, '2026-06-25 10:00:00']]
    );

    await seedIfEmpty('testimonials',
        `INSERT INTO testimonials (name_en, name_rw, role_en, role_rw, text_en, text_rw, initials, rating, sort_order) VALUES ?`,
        [         ['Fatima Ahmed', 'Fatima Ahmed', 'Student since 2025', 'Umunyeshuri kuva 2025', 'Modern Skills transformed my Quran learning journey. The Tajweed lessons are incredibly clear and the instructors are so patient. I finally feel confident in my recitation.', 'Modern Skills yahinduye urugendo rwanjye rwo kwiga Quran. Amasomo ya Tajweed asobanutse cyane kandi abigisha bafite ihangane. Nongeye kwizera mu gusoma kwanjye.', 'FA', 5, 1],
         ['Omar Khalid', 'Omar Khalid', 'Student since 2024', 'Umunyeshuri kuva 2024', 'Alhamdulillah, I started as a complete beginner and now I can read Arabic script fluently. The structured curriculum makes all the difference. Highly recommended!', 'Alhamdulillah, natangiye nk\'umutangizi wuzuye noneho nshobora gusoma inyandiko y\'icyarabu neza. Gahunda y\'amasomo itunganijwe niyo itanga itandukaniro. Ndabyifuriza cyane!', 'OK', 5, 2],
         ['Aisha Noor', 'Aisha Noor', 'Parent of student', 'Umubyeyi w\'umunyeshuri', 'The Hifz program is amazing! My son has memorized 5 Juz in just 6 months thanks to the effective repetition techniques taught by Hafiz Yusuf Khan.', 'Gahunda ya Hifz irababaje! Umuhungu wanjye yibukije Juz 5 mu mezi 6 gusa kubera tekiniki nziza zo gusubiramo zigishwa na Hafiz Yusuf Khan.', 'AN', 5, 3]]
    );
}

async function ensureQuranContent() {
    const pool = require('./config/db');
    const [cats] = await pool.query("SELECT id FROM categories WHERE slug = 'quran' LIMIT 1");
    let categoryId = cats[0]?.id;
    if (!categoryId) {
        const [r] = await pool.query(
            `INSERT INTO categories (name, slug, description, icon_class, color, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
            ["Qur'an Courses", 'quran', "Structured Qur'an reading, memorization and understanding courses.", 'fa-book-quran', 'gold', 0]
        );
        categoryId = r.insertId;
    }
    const courses = [
        ["Qur'an Reading — Beginner to Fluent", 'quran-reading-beginner-fluent', "Learn Arabic letters, pronunciation and fluent Qur'an reading step by step.", 'Beginner', 40, 1],
        ["Hifz Roadmap — Juz by Juz", 'hifz-roadmap-juz-by-juz', "A structured memorization and revision course for learners building a daily Hifz routine.", 'Intermediate', 35, 1],
        ["Qur'an Recitation & Tajweed Mastery", 'quran-recitation-tajweed-mastery', "Improve recitation with Makharij, Sifaat, Madd and practical Tajweed exercises.", 'All Levels', 45, 1],
        ["Understanding the Qur'an — Tafsir Foundations", 'quran-tafsir-foundations', "Foundations for understanding selected Surahs, vocabulary and key lessons.", 'Beginner', 50, 1]
    ];
    for (const [title, slug, description, difficulty, duration, published] of courses) {
        await pool.query(
            `INSERT INTO lessons (title, slug, description, category_id, difficulty, duration_minutes, rating, student_count, is_published, is_featured)
             VALUES (?, ?, ?, ?, ?, ?, 5.0, 0, ?, 0)
             ON DUPLICATE KEY UPDATE title=VALUES(title), description=VALUES(description), category_id=VALUES(category_id), difficulty=VALUES(difficulty), duration_minutes=VALUES(duration_minutes), is_published=VALUES(is_published)`,
            [title, slug, description, categoryId, difficulty, duration, published]
        );
    }
    console.log("  ✓ Qur'an courses ready");
}

async function initDatabase() {
    if (driver === 'supabase') {
        await initSupabase();
        return;
    }
    console.log('Checking database setup...');
    try {
        await ensureDatabase();
        await createTables();
        console.log('  ✓ Tables ready');
        await migrateExistingTables();
        await ensureAdmin();
        await seedDemoContent();
        await ensureQuranContent();
        console.log('Database setup complete.');
    } catch (err) {
        console.error('Database setup failed:', err.message);
    }
}

module.exports = { initDatabase };