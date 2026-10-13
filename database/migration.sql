USE noor_academy;

-- ============================================================
-- TESTIMONIALS
-- ============================================================
CREATE TABLE IF NOT EXISTS testimonials (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO testimonials (name_en, name_rw, role_en, role_rw, text_en, text_rw, initials, rating, sort_order) VALUES
('Fatima Ahmed', 'Fatima Ahmed', 'Student since 2025', 'Umunyeshuri kuva 2025', 'Modern Skills transformed my Quran learning journey. The Tajweed lessons are incredibly clear and the instructors are so patient. I finally feel confident in my recitation.', 'Modern Skills yahinduye urugendo rwanjye rwo kwiga Quran. Amasomo ya Tajweed asobanutse cyane kandi abigisha bafite ihangane. Nongeye kwizera mu gusoma kwanjye.', 'FA', 5, 1),
('Omar Khalid', 'Omar Khalid', 'Student since 2024', 'Umunyeshuri kuva 2024', 'Alhamdulillah, I started as a complete beginner and now I can read Arabic script fluently. The structured curriculum makes all the difference. Highly recommended!', 'Alhamdulillah, natangiye nk''umutangizi wuzuye noneho nshobora gusoma inyandiko y''icyarabu neza. Gahunda y''amasomo itunganijwe niyo itanga itandukaniro. Ndabyifuriza cyane!', 'OK', 5, 2),
('Aisha Noor', 'Aisha Noor', 'Parent of student', 'Umubyeyi w''umunyeshuri', 'The Hifz program is amazing! My son has memorized 5 Juz in just 6 months thanks to the effective repetition techniques taught by Hafiz Yusuf Khan.', 'Gahunda ya Hifz irababaje! Umuhungu wanjye yibukije Juz 5 mu mezi 6 gusa kubera tekiniki nziza zo gusubiramo zigishwa na Hafiz Yusuf Khan.', 'AN', 5, 3);

-- ============================================================
-- USER PREFERENCES
-- ============================================================
CREATE TABLE IF NOT EXISTS user_preferences (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    pref_key VARCHAR(50) NOT NULL,
    pref_value VARCHAR(255) DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_user_pref (user_id, pref_key),
    CONSTRAINT fk_pref_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- PAYMENTS (MoMo payment verification)
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    lesson_id INT NOT NULL,
    transaction_code VARCHAR(50) NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
    admin_note TEXT DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP NULL,
    INDEX idx_payments_user (user_id),
    INDEX idx_payments_lesson (lesson_id),
    INDEX idx_payments_status (status),
    CONSTRAINT fk_payments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_payments_lesson FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Fix: users.phone_number and lessons.price were referenced by
-- the payments feature but never added to the original schema.
-- Safe to run even if columns already exist (checked first).
-- ============================================================
SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'phone_number'
);
SET @sql := IF(@col_exists = 0,
    'ALTER TABLE users ADD COLUMN phone_number VARCHAR(20) DEFAULT NULL AFTER full_name',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lessons' AND COLUMN_NAME = 'price'
);
SET @sql := IF(@col_exists = 0,
    'ALTER TABLE lessons ADD COLUMN price DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER thumbnail_url',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================
-- TIER-BASED ACCESS (video / weekly / monthly)
-- ============================================================
-- Add access_type column to payments
SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND COLUMN_NAME = 'access_type'
);
SET @sql := IF(@col_exists = 0,
    'ALTER TABLE payments ADD COLUMN access_type ENUM(''video'',''weekly'',''monthly'') DEFAULT NULL AFTER lesson_id',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add access_expires_at column to payments
SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND COLUMN_NAME = 'access_expires_at'
);
SET @sql := IF(@col_exists = 0,
    'ALTER TABLE payments ADD COLUMN access_expires_at TIMESTAMP NULL DEFAULT NULL AFTER reviewed_at',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Make transaction_code nullable (no longer required)
SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND COLUMN_NAME = 'transaction_code' AND IS_NULLABLE = 'NO'
);
SET @sql := IF(@col_exists > 0,
    'ALTER TABLE payments MODIFY COLUMN transaction_code VARCHAR(50) DEFAULT NULL',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add is_active column to users (already in supabase/Schrema.sql but ensure it exists)
SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'is_active'
);
SET @sql := IF(@col_exists = 0,
    'ALTER TABLE users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER avatar_url',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================
-- BOOKS (admin-authored reading material for books.html)
-- ============================================================
CREATE TABLE IF NOT EXISTS books (
    id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(255) NOT NULL,
    author VARCHAR(150) DEFAULT NULL,
    description TEXT DEFAULT NULL,
    cover_url VARCHAR(500) DEFAULT NULL,
    content MEDIUMTEXT DEFAULT NULL,
    language VARCHAR(10) NOT NULL DEFAULT 'en',
    sort_order INT NOT NULL DEFAULT 0,
    is_published TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_books_published (is_published),
    INDEX idx_books_sort (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- MODERN SKILLS QUR'AN COURSE EXTENSION
-- ============================================================
INSERT INTO categories (name, slug, description, icon_class, color, sort_order)
SELECT 'Qur\'an Courses', 'quran', 'Structured Qur\'an reading, memorization and understanding courses.', 'fa-book-quran', 'gold', 0
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE slug = 'quran');
