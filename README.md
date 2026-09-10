# Vakit · Günlük Ritim PWA

Namaz vakitlerini merkeze alan sade bir günlük ritim uygulaması. Varsayılan konum **Etimesgut / Ankara**. Vakitler her gün sunucudan alınır; konum değişince günün planı ve push bildirimleri yeniden hesaplanır.

## İçerik
- Sabah uyanış: **güneşten 20 dakika önce** (ayarlanabilir)
- Sabah namazı sonrası, güneş doğunca yürüyüş/bisiklet başlangıç bildirimi
- Aktivite bitimine 5 dakika kala ve bitişte bildirim
- Kahvaltı önerileri ve “başka öner” akışı
- Öğle, ikindi, akşam, yatsı için 5 dakika önceden bildirim
- Öğle vakti çevresinde şekerleme yerleştirmeyen kişisel koruma aralığı
- Gece uykusu kısa kaldığında 20 dakikayı “yeterli telafi” saymayan uyku borcu uyarısı
- 25/5 ve 50/10 Pomodoro
- Gün sonu özet ekranı
- Tek dokunuşla izin günü: iş bildirimleri kapanır
- İlçe/il değişikliği: namaz vakitleri ve bildirim planı yenilenir
- Veriler tarayıcı localStorage'ında; hesap/giriş yok

## iPhone PWA ve bildirim
Apple tarafında güvenilir arka plan bildirimi için uygulamanın **Safari → Paylaş → Ana Ekrana Ekle** ile kurulması ve bildirim izninin PWA içinden kullanıcı dokunuşuyla verilmesi gerekir. Yalnızca `setTimeout`/JavaScript zamanlayıcıları, uygulama tamamen kapalıyken güvenilir değildir; bu yüzden projede standart Web Push sunucusu vardır.

## Çalıştırma
```bash
npm install
npm start
```
Sonra `http://localhost:3000`.

## Production
HTTPS zorunludur. Tek servis olarak Node sunucusunu Railway/Fly.io/Render benzeri **uyumayan** bir Node hostuna koyabilirsin. Push sunucusunun 24/7 çalışması, dakik bildirimin güvenilirliği için önemlidir. Kalıcı disk/volume vermezsen deploy/restart sonrası push aboneliğini yeniden açmak gerekebilir.

`DATA_DIR` ortam değişkenini kalıcı bir volume dizinine (ör. `/data`) bağlamak önerilir. İlk çalıştırmada VAPID anahtarları otomatik üretilip bu dizinde saklanır.

## Namaz verisi
Sunucu konumu Open-Meteo geocoding ile bulur ve AlAdhan üzerinden `method=13` ile Türkiye/Diyanet hesap yöntemini ister. Üretime almadan önce kullandığın kaynağın Diyanet'in yayınladığı vakitlerle birkaç gün karşılaştırılması tavsiye edilir; üçüncü taraf servisler erişilemezse uygulama önizleme verisini açıkça “önizleme” olarak işaretler ve bunu gerçek vakit diye gizlemez.

## Uyku mantığı
Uygulama, örneğin 02:15 yatış ve 06:00 uyanış gibi çok kısa bir ana uyku oluşursa 20 dakikalık şekerlemeyi yeterli göstermemeye çalışır. Ana uyku 5,5 saatin altındaysa 90 dakikalık telafi bloğu önerir. Bu tıbbi tedavi değildir; kalıcı gündüz uykululuğu, horlama/nefes kesilmesi veya yeterli süreye rağmen dinlenememe sürerse klinik değerlendirme gerekir.
