require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

async function seed() {
    try {
        console.log('Seeding database...');

        const passwordHash = await bcrypt.hash('Admin@123', 10);

        await pool.query(
            `INSERT INTO users (username, email, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), password_hash = VALUES(password_hash)`,
            ['admin', 'admin@nooracademy.com', passwordHash, 'Admin User', 'admin']
        );
        console.log('  ✓ Admin user created (admin@nooracademy.com / Admin@123)');

        await pool.query(
            `INSERT INTO categories (name, slug, description, icon_class, color, sort_order) VALUES
             ('Tajweed', 'tajweed', 'Menya gusoma Qur\'an mu buryo bukwiye hamwe n\'amategeko ya Tajweed', 'fa-voice', 'gold', 1),
             ('Tafsir', 'tafsir', 'Ubusobanuro bwimbitse bw\'amagambo ya Qur\'an n\'ibyo asobanura', 'fa-book-open', 'green', 2),
             ('Hifz', 'hifz', 'Gahunda itunganijwe yo kwibuka Qur\'an hamwe no gukurikirana isubiramo', 'fa-brain', 'blue', 3),
             ('Arabic', 'arabic', 'Iga Icyarabu cy\'umwimerere kugira ngo usobanukirwe na Qur\'an utizigamye', 'fa-language', 'purple', 4),
             ('Video Course', 'video-course', 'Amafirime yanditswe mu buryo bwuzuye yigishwa n\'abigisha babahanga', 'fa-video', 'rose', 5)
             ON DUPLICATE KEY UPDATE name = VALUES(name)`
        );
        console.log('  ✓ Categories created');

        await pool.query(
            `INSERT INTO instructors (name, slug, bio, expertise) VALUES
             ('Sheikh Ahmad Al-Misri', 'sheikh-ahmad-al-misri', 'Umusomyi ukomeye wa Qur\'an n\'umwarimu wa Tajweed ufite uburambe bw\'imyaka irenga 15', 'Tajweed, Qiraat'),
             ('Dr. Aminah Al-Arabi', 'dr-aminah-al-arabi', 'Afite PhD mu bya Isilamu, yibanda ku busobanuro bwa Tafsir bwa Qur\'an', 'Tafsir, Amasomo ya Isilamu'),
             ('Hafiz Yusuf Khan', 'hafiz-yusuf-khan', 'Hafiz wemejwe ufite Ijaza muri Hifz n\'uburambe bwinshi mu kwigisha', 'Hifz, Uburyo bwo Kwibuka'),
             ('Ustadh Omar Farooq', 'ustadh-omar-farooq', 'Umunyamabanga mu cyarabu akaba n\'umwarimu w\'amasomo ya Isilamu', 'Imbonerahamwe y\'Icyarabu, Fiqh')
             ON DUPLICATE KEY UPDATE name = VALUES(name)`
        );
        console.log('  ✓ Instructors created');

        await pool.query(
            `INSERT INTO tags (name, slug) VALUES
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
             ('advanced', 'advanced')
             ON DUPLICATE KEY UPDATE name = VALUES(name)`
        );
        console.log('  ✓ Tags created');

        await pool.query(
            `INSERT INTO lessons (title, slug, description, category_id, instructor_id, difficulty, duration_minutes, video_url, rating, student_count, is_published, is_featured, created_at) VALUES
             ('Intangiriro ya Makhaarij & Sifaat', 'makhaarij-sifaat', 'Iga aho buri nyuguti y\'Icyarabu ituruka, n\'imiterere iha buri nyuguti ijwi ryaryo ryihariye. Ni intambwe ya mbere nziza ku batangira.', 1, 1, 'Beginner', 28, 'https://www.youtube.com/watch?v=O2wSMWemJDU', 5.0, 234, 1, 1, '2026-07-25 10:00:00'),
             ('Tafsir ya Surah Al-Fatiha', 'surah-al-fatiha-tafsir', 'Ubusobanuro bwimbitse bw\'ibisobanuro n\'inyigisho bya Surah Al-Fatiha, isura ya mbere ya Qur\'an.', 2, 2, 'All Levels', 35, 'https://www.youtube.com/watch?v=0lMkdXrCCrg', 4.9, 567, 1, 1, '2026-07-22 10:00:00'),
             ('Juz Amma — Surah An-Naba', 'juz-amma-surah-an-naba', 'Fata Surah An-Naba ku mutwe hamwe na Tajweed ikwiye ukoresheje uburyo bwacu bwo gusubiramo buhoro buhoro.', 3, 3, 'Beginner', 22, 'https://www.youtube.com/watch?v=oSppMwLcfS0', 4.8, 892, 1, 1, '2026-07-20 10:00:00'),
             ('Insingiro z\'Imbonerahamwe y\'Icyarabu', 'arabic-grammar-essentials', 'Sobanukirwa ibice bitatu by\'ijambo mu cyarabu: amazina, inshinga, n\'utunyegero.', 4, 4, 'Beginner', 42, 'https://www.youtube.com/watch?v=OoVhY3rcXS8', 4.7, 345, 0, 0, '2026-07-18 10:00:00'),
             ('Noon Sakinah & Tanween', 'noon-sakinah-tanween', 'Ubuyobozi bwuzuye bw\'amategeko ya Noon Sakinah na Tanween.', 1, 1, 'Intermediate', 31, 'https://www.youtube.com/watch?v=ALGAanskdXs', 4.9, 178, 0, 0, '2026-07-15 10:00:00'),
             ('Tafsir ya Ayatul Kursi', 'tafsir-ayatul-kursi', 'Menya umurongo ukomeye wa Qur\'an — Ayatul Kursi.', 2, 2, 'All Levels', 25, 'https://www.youtube.com/watch?v=4fvwdWdfEHI', 4.9, 912, 1, 1, '2026-07-12 10:00:00'),
             ('Kwibuka Surah Al-Fatiha', 'al-fatiha-memorization', 'Fata Surah Al-Fatiha ku mutwe hamwe na Tajweed ikwiye ukoresheje uburyo bworoshye bwo gusubiramo.', 3, 3, 'Beginner', 18, 'https://www.youtube.com/watch?v=Ca2nxrD8x-g', 4.8, 423, 1, 0, '2026-07-10 10:00:00'),
             ('Amategeko ya Madd — Inyuguti Zigurwa', 'madd-rules-extended-letters', 'Iga amategeko yose ya Madd — Madd Tabi\'i, Madd Wajib, na Madd Ja\'iz.', 1, 1, 'Advanced', 26, 'https://www.youtube.com/watch?v=iMIHgkkOJco', 4.9, 156, 0, 0, '2026-07-08 10:00:00'),
             ('Ibihe by\'Inshinga z\'Icyarabu', 'arabic-verb-conjugation', 'Sobanukirwa uko inshinga z\'icyarabu zihinduka ibihe byazo — ibyashize, ibiriho, n\'itegeko.', 4, 4, 'Intermediate', 38, 'https://www.youtube.com/watch?v=OoVhY3rcXS8', 4.7, 289, 1, 0, '2026-07-05 10:00:00'),
             ('Juz Tabarak — Surah Al-Mulk', 'juz-tabarak-surah-al-mulk', 'Fata Surah Al-Mulk ku mutwe hamwe na Tajweed ikwiye.', 3, 3, 'Intermediate', 20, 'https://www.youtube.com/watch?v=Ca2nxrD8x-g', 4.8, 312, 0, 0, '2026-07-02 10:00:00'),
             ('Inshuranyo y\'Inyigisho Yose ya Tajweed', 'complete-tajweed-course-overview', 'Inshuranyo y\'inyigisho yacu yuzuye ya Tajweed ikubiyemo amategeko yose akomeye.', 5, 1, 'All Levels', 12, 'https://www.youtube.com/watch?v=iMIHgkkOJco', 5.0, 1250, 1, 0, '2026-06-28 10:00:00'),
             ('Tafsir ya Surah Yaseen', 'tafsir-of-surah-yaseen', 'Ubusobanuro burambuye bwa Surah Yaseen — umutima wa Qur\'an.', 2, 2, 'Advanced', 45, 'https://www.youtube.com/watch?v=MzijGS3Zo_0', 4.9, 734, 0, 0, '2026-06-25 10:00:00')
             ON DUPLICATE KEY UPDATE title = VALUES(title), video_url = VALUES(video_url)`
        );
        console.log('  ✓ Lessons created');

        await pool.query(
            `INSERT INTO testimonials (name_en, name_rw, role_en, role_rw, text_en, text_rw, initials, rating, sort_order) VALUES
             ('Fatima Ahmed', 'Fatima Ahmed', 'Student since 2025', 'Umunyeshuri kuva 2025', 'Modern Skills transformed my Quran learning journey. The Tajweed lessons are incredibly clear and the instructors are so patient. I finally feel confident in my recitation.', 'Modern Skills yahinduye urugendo rwanjye rwo kwiga Quran. Amasomo ya Tajweed asobanutse cyane kandi abigisha bafite ihangane. Nongeye kwizera mu gusoma kwanjye.', 'FA', 5, 1),
             ('Omar Khalid', 'Omar Khalid', 'Student since 2024', 'Umunyeshuri kuva 2024', 'Alhamdulillah, I started as a complete beginner and now I can read Arabic script fluently. The structured curriculum makes all the difference. Highly recommended!', 'Alhamdulillah, natangiye nk''umutangizi wuzuye noneho nshobora gusoma inyandiko y''icyarabu neza. Gahunda y''amasomo itunganijwe niyo itanga itandukaniro. Ndabyifuriza cyane!', 'OK', 5, 2),
             ('Aisha Noor', 'Aisha Noor', 'Parent of student', 'Umubyeyi w''umunyeshuri', 'The Hifz program is amazing! My son has memorized 5 Juz in just 6 months thanks to the effective repetition techniques taught by Hafiz Yusuf Khan.', 'Gahunda ya Hifz irababaje! Umuhungu wanjye yibukije Juz 5 mu mezi 6 gusa kubera tekiniki nziza zo gusubiramo zigishwa na Hafiz Yusuf Khan.', 'AN', 5, 3)
             ON DUPLICATE KEY UPDATE name_en = VALUES(name_en)`
        );
        console.log('  ✓ Testimonials created');

        await pool.query(
            `INSERT INTO user_preferences (user_id, pref_key, pref_value) VALUES
             (1, 'language', 'en')
             ON DUPLICATE KEY UPDATE pref_value = VALUES(pref_value)`
        );
        console.log('  ✓ Default preferences created');

        console.log('\n✅ Database seeded successfully!');
        console.log('   Admin login: admin@nooracademy.com / Admin@123');
        process.exit(0);
    } catch (err) {
        console.error('Seed error:', err);
        process.exit(1);
    }
}

seed();
