# Vakit · Günlük Ritim PWA

Namaz vakitlerini merkeze alan sade günlük ritim uygulaması. Varsayılan konum **Etimesgut / Ankara**. Sabah uyanış, namaz vakitleri, yürüyüş/bisiklet, kahvaltı, şekerleme ve Pomodoro akışını tek yerde toplar.

## Cloudflare mimarisi

Bu sürüm Cloudflare için hazırlanmıştır:

- **Cloudflare Worker**: API ve Web Push gönderimi
- **Static Assets**: `public/` içindeki PWA arayüzü
- **Cloudflare D1**: push abonelikleri, zamanlanmış olaylar, VAPID anahtarı ve namaz vakti cache'i
- **Cron Trigger**: her dakika zamanı gelen bildirimleri kontrol eder

Eski Express/Node sunucusu kaldırılmıştır. Railway/Render gerektirmez.

## Cloudflare panelinde kurulum

1. Cloudflare hesabında **Workers & Pages** bölümüne gir.
2. Yeni bir Worker oluşturup GitHub repository olarak `dgdfurkan/PushNot` seç.
3. Repo kök dizinini kullan. Wrangler ayarı `wrangler.jsonc` dosyasındadır.
4. Cloudflare panelinden bir **D1 Database** oluştur. Önerilen ad: `pushnot-db`.
5. Worker > **Settings > Bindings** bölümünden D1 binding ekle:
   - Variable / Binding name: `DB`
   - Database: oluşturduğun `pushnot-db`
6. Deploy/redeploy et.
7. Worker adresinde `/api/health` aç. `{"ok":true,"runtime":"cloudflare-worker"...}` görürsen backend çalışıyor.
8. Ana sayfayı iPhone Safari'de aç, **Paylaş > Ana Ekrana Ekle** yap.
9. Ana ekrandaki PWA'yı açıp **Bildirimleri Aç** ve ardından **Test bildirimi gönder** butonunu kullan.

> Worker ilk API isteğinde gerekli D1 tablolarını ve VAPID anahtarlarını otomatik oluşturur. Ayrı SQL çalıştırman gerekmez.

## Bildirim akışı

- Uyanış: güneşten varsayılan 20 dakika önce
- Sabah hareketi: güneş doğduktan hemen sonra
- Öğle, ikindi, akşam ve yatsı: 5 dakika önce
- Şekerleme ve iş bildirimi: uygulamadaki günlük plana göre
- Aktivite bitimine 5 dakika kala ve bitişte: aktivite başlatıldığında planlanır

## iPhone notu

iOS'ta Web Push için siteyi yalnızca Safari sekmesinde açık tutmak yetmez. PWA'yı **Ana Ekrana Ekle** ile kurup bildirim iznini ana ekrandan açılan uygulama içinden vermelisin.

## Namaz vakitleri

Konum Open-Meteo geocoding ile çözülür; namaz vakitleri AlAdhan üzerinden `method=13` Türkiye/Diyanet hesap yöntemiyle istenir. Uygulama servis erişilemezse örnek veriyi açıkça önizleme olarak işaretler.

## Yerel geliştirme

```bash
npm install
npm run dev
```

Cloudflare D1 binding'i yerel ortamda da gerektiği için gerçek API/push testi için Wrangler D1 ayarı gerekir.
