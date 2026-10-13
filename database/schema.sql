-- ============================================================
-- Modern Skills — Quran Teaching Platform Database Schema
-- Compatible with MySQL Workbench 8.0+
-- ============================================================

CREATE DATABASE IF NOT EXISTS noor_academy
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE noor_academy;

-- ============================================================
-- USERS (admin & students)
-- ============================================================
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(20) DEFAULT NULL,
    role ENUM('admin', 'student') NOT NULL DEFAULT 'student',
    avatar_url VARCHAR(500) DEFAULT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    last_login TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_users_email (email),
    INDEX idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- CATEGORIES (Tajweed, Tafsir, Hifz, Arabic, Video Courses)
-- ============================================================
CREATE TABLE categories (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- INSTRUCTORS
-- ============================================================
CREATE TABLE instructors (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TAGS
-- ============================================================
CREATE TABLE tags (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL,
    slug VARCHAR(50) NOT NULL UNIQUE,
    INDEX idx_tags_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- LESSONS
-- ============================================================
CREATE TABLE lessons (
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
    price DECIMAL(10,2) NOT NULL DEFAULT 0,
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- LESSON-TAGS (many-to-many)
-- ============================================================
CREATE TABLE lesson_tags (
    lesson_id INT NOT NULL,
    tag_id INT NOT NULL,
    PRIMARY KEY (lesson_id, tag_id),
    CONSTRAINT fk_lesson_tags_lesson FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_lesson_tags_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- ENROLLMENTS (student enrollment in lessons)
-- ============================================================
CREATE TABLE enrollments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    lesson_id INT NOT NULL,
    enrolled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_enrollment (user_id, lesson_id),
    INDEX idx_enrollments_user (user_id),
    INDEX idx_enrollments_lesson (lesson_id),
    CONSTRAINT fk_enrollments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_enrollments_lesson FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- LESSON PROGRESS (track student watching progress)
-- ============================================================
CREATE TABLE lesson_progress (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- CONTACT MESSAGES (from website contact form)
-- ============================================================
CREATE TABLE contact_messages (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL,
    subject VARCHAR(255) DEFAULT NULL,
    message TEXT NOT NULL,
    is_read TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_messages_read (is_read)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- SEED DATA
-- ============================================================

-- Default admin user (password: admin123 — change immediately!)
INSERT INTO users (username, email, password_hash, full_name, role) VALUES
('admin', 'admin@nooracademy.com', '$2b$10$8KzQMGx5C5P3Y5Y5Y5Y5Y5Y5Y5Y5Y5Y5Y5Y5Y5Y5Y5Y5Y5Y5Y5Y', 'Admin User', 'admin');

-- Categories
INSERT INTO categories (name, slug, description, icon_class, color, sort_order) VALUES
('Tajweed', 'tajweed', 'Master Quran recitation with proper pronunciation and rules', 'fa-voice', 'gold', 1),
('Tafsir', 'tafsir', 'Deep understanding of Quranic verses and their meanings', 'fa-book-open', 'green', 2),
('Hifz', 'hifz', 'Structured memorization program with revision tracking', 'fa-brain', 'blue', 3),
('Arabic', 'arabic', 'Learn classical Arabic to understand the Quran directly', 'fa-language', 'purple', 4),
('Video Course', 'video-course', 'Comprehensive recorded courses with expert instructors', 'fa-video', 'rose', 5);
-- Note: a "Qur'an Courses" category (slug: quran) is auto-created on first
-- server boot by backend/init.js's ensureQuranContent(), along with 4 seed
-- lessons — no need to add it here manually.

-- Instructors
INSERT INTO instructors (name, slug, bio, expertise) VALUES
('Sheikh Ahmad Al-Misri', 'sheikh-ahmad-al-misri', 'Expert Quran reciter and Tajweed teacher with 15+ years of experience', 'Tajweed, Qiraat'),
('Dr. Aminah Al-Arabi', 'dr-aminah-al-arabi', 'PhD in Islamic Studies specializing in Quranic Tafsir', 'Tafsir, Islamic Studies'),
('Hafiz Yusuf Khan', 'hafiz-yusuf-khan', 'Certified Hafiz with Ijaza in Hifz and extensive teaching experience', 'Hifz, Memorization Techniques'),
('Ustadh Omar Farooq', 'ustadh-omar-farooq', 'Arabic language specialist and Islamic studies instructor', 'Arabic Grammar, Fiqh');

-- Tags
INSERT INTO tags (name, slug) VALUES
('tajweed', 'tajweed'),
('noon-sakinah', 'noon-sakinah'),
('pronunciation', 'pronunciation'),
('makharij', 'makharij'),
('sifaat', 'sifaat'),
('tafsir', 'tafsir'),
('al-fatiha', 'al-fatiha'),
('al-kahf', 'al-kahf'),
('hifz', 'hifz'),
('memorization', 'memorization'),
('juz-amma', 'juz-amma'),
('arabic', 'arabic'),
('grammar', 'grammar'),
('beginner', 'beginner'),
('advanced', 'advanced');
