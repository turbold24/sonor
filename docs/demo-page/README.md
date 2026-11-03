# Demo Page: Дулаан Дээл

The Facebook Page shown in the demo video plays the fictional clothing shop **Дулаан Дээл** from the seed data (`apps/api/prisma/demo-data.ts`, slug `dulaan-deel`). Everything here is made up; any resemblance to a real shop is accidental.

| File              | Use                                                  | Size        |
| ----------------- | ---------------------------------------------------- | ----------- |
| `out/profile.png` | Page profile picture (Facebook crops it to a circle) | 1080 × 1080 |
| `out/cover.png`   | Page cover photo                                     | 1640 × 924  |

Phones show the whole cover (16:9). Desktop crops it to the middle band, so the text and the two pattern bands stay inside that band. The bottom-left corner, where the profile picture overlaps on phones, is empty.

To change the images, edit `src/*.html` and render them again with headless Chrome:

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --hide-scrollbars --force-device-scale-factor=1 --window-size=1080,1080 --screenshot=out/profile.png "file://$PWD/src/profile.html"
"$CHROME" --headless=new --hide-scrollbars --force-device-scale-factor=1 --window-size=1640,924 --virtual-time-budget=8000 --screenshot=out/cover.png "file://$PWD/src/cover.html"
```

Run it from `docs/demo-page`. The cover loads Playfair Display and Montserrat from Google Fonts (both have Cyrillic).

## Page details

Paste these in. They match the seed data, so the Page and the bot tell the same story.

- **Name:** Дулаан Дээл
- **Username:** `dulaandeel` (if it's taken, try `dulaandeel.shop`)
- **Category:** Clothing store
- **Bio** (83 of 101 characters):

  ```text
  Орчин үеийн дээл, ноолуур, өвлийн хувцас. Асуулт, захиалгаа Messenger-ээр бичээрэй.
  ```

- **Hours:** Monday to Friday 10:00–19:00, closed on weekends. This matches the bot's handoff message.
- **Location:** at most the city, Улаанбаатар. No street address.
- **Phone, email, website:** leave empty. A made-up phone number may belong to a real person.
- **Action button:** Send message.

## Messenger automations: turn them off

In Meta Business Suite → Inbox → Automations, turn off **Instant reply**, **Away message** and **Frequently asked questions**. Facebook sends those replies from the Page, and Sonor receives each one as an echo that it didn't send. Sonor treats such echoes as the owner taking over (`messenger.service.ts`), so the bot pauses itself in that chat.

## Posts (optional)

A few posts make the Page look lived-in. The prices are the seed prices, so they match what the bot quotes. Pin the first one.

```text
Сайн байна уу! Дулаан Дээлийн хуудсанд тавтай морилно уу.

Бид уламжлалт хээг орчин үеийн загвартай хослуулсан дээл, ноолууран бүтээгдэхүүн, өвлийн дулаан хувцас санал болгодог.

Үнэ, хэмжээ, өнгө асуух бол Messenger-ээр бичээрэй. Захиалгаа ч чатаар өгч болно.
```

```text
Шинэ бараа ирлээ! Хурганы арьсан дотортой өвлийн дээл

-40°C хүйтэнд ч дулаан. Гадна тал нь ус нэвтрүүлэхгүй даавуу.
Хэмжээ: M, L, XL · Өнгө: хар, бор
Үнэ: 690,000₮

Захиалах бол Messenger-ээр бичээрэй.
```

```text
Ноолууран малгай. 100% ноолуур, зөөлөн, чихийг бүрэн хамгаална.

Өнгө: саарал, хар, цөцгийн цагаан
Үнэ: 59,000₮

Бэлэгт ч тохиромжтой. Messenger-ээр захиалаарай.
```
