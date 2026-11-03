# Installing Alder on your Samsung TV

You only need an **Android phone** and the **TV remote**. The first time takes about 20 minutes; an update takes two.

Button and screen names below are the ones in the Apps2Samsung phone app (its bottom bar says Install, On the TV, Remote,
Settings) and on a 2020 Samsung TV. If your TV words something a little differently, follow the sense, not the letters.

Before you start:
- The TV is **on** (not in standby) and on the **same Wi-Fi** as the phone.
- You have the file **`Alder.wgt`** on the phone (see step 5).
- You have a **Samsung account** (free). Apps2Samsung asks you to sign in to it once.

---

## Part 1: one time

### 1. Put Apps2Samsung on the phone

Pick one:
- Open <https://github.com/Apps2Samsung/Apps2Samsung/releases> on the phone, download the file ending in `-android.apk`
  from the latest stable release, open it, and allow "install unknown apps" if Android asks.
- Or, in the F-Droid app, add the repository `https://apps2samsung.com/fdroid/repo` and install Apps2Samsung from it.
- Or add `https://github.com/Apps2Samsung/Apps2Samsung` to the Obtainium app.

### 2. Turn on Developer Mode on the TV

1. On the remote press **Home**, then go to **Apps**.
2. With the Apps screen open, press **1 2 3 4 5** on the remote. (If your remote has no number keys, a number pad appears on
   screen: use that.)
3. A **Developer mode** window opens. Switch it **On**.
4. In the box **Host PC IP** type your **phone's IP address** (step 3 below shows you where to find it), then press **OK**.
5. **Restart the TV**: hold the power button until the TV switches off and comes back, or unplug it for 30 seconds.
   Developer Mode does not work until it has been restarted.

### 3. Find your phone's IP address

Apps2Samsung shows it for you: if the TV is not ready it opens a guide that says "Enter this IP address" and prints the
number. You can also find it on the phone: **Settings, Connections, Wi-Fi**, tap the gear next to your network, and read
**IP address** (it looks like `192.168.1.23`). Type exactly those four numbers on the TV.

### 4. Let Apps2Samsung find the TV

1. Open **Apps2Samsung** on the phone, on the **Install** tab.
2. After a few seconds your TV appears in the card at the top with **Ready to install.** If it does not, see
   "Troubleshooting" below.

---

## Part 2: install Alder (the first time and every update)

### 5. Get `Alder.wgt` onto the phone

Download `Alder.wgt` to the phone from <https://github.com/esedmemmed/Alder-tizen/raw/main/release/Alder.wgt> (or from wherever you
were given it). It is a small file (about 450 KB). A normal browser download goes to the **Downloads** folder. Do not rename it
and do not unzip it.

### 6. Install it

1. In Apps2Samsung, on the **Install** tab, scroll to the bottom to **Your own package**.
2. Tap **WGT / TPK** ("Install a .wgt or .tpk file") and choose `Alder.wgt` from Downloads.
3. The first time only, a sheet says Samsung only runs apps signed for this TV. Tap **Sign in with Samsung** and sign in with
   your Samsung account in the page that opens. Apps2Samsung makes the certificate for your TV and keeps it for the next
   installs. If it asks for an email address on the account, add and verify one at account.samsung.com and try again.
4. Wait while it goes through the steps (prepare the certificate, sign the package, install on the TV). When it says
   **Installed Alder. Open the TV's Apps list to launch it.** it is done.

### 7. Open Alder

On the TV, press **Home**, go to **Apps**, and open **Alder**. The first start asks you to name a profile and shows a code
and a QR picture: on your phone scan the QR (or open the link shown) and sign in to Stremio. Alder then opens by itself.

---

## Updating Alder

Repeat Part 2 with the new `Alder.wgt`: Apps2Samsung, **Your own package**, **WGT / TPK**, pick the file. It installs over
the old one and keeps the same tile. You do not repeat Part 1 or the Samsung sign-in.

If the TV says the app is already installed with a different certificate, remove the old one first: on the TV open the **Apps**
list, press and hold on **Alder**, choose **Remove**, then install again.

---

## Troubleshooting

### Apps2Samsung does not find the TV

1. TV on, awake, and on the same Wi-Fi as the phone (not a guest network, not mobile data).
2. Tap **Rescan** (or the three dots at the top, then **Rescan for TVs**).
3. Still nothing: three dots, **Add TV by IP**, and type the TV's IP address. It is in the TV's own Settings under
   General, Network, Network Status (the exact path differs a little between TV models).
4. Check Developer Mode is still **On** (step 2). Some TVs switch it off after a firmware update.

### The TV is found but it says Developer Mode or the IP is wrong

Apps2Samsung opens a guide with the same steps as step 2 and checks the TV every few seconds. Follow it: switch Developer
Mode On, type the IP it shows in **Host PC IP**, restart the TV, wait for the guide to say it is ready.

If it says the IP is "back to front", type it in reverse order on the TV (192.168.1.2 becomes 2.1.168.192): some TVs store it
the other way round.

### The install fails

- Read the message on the progress sheet and look at the notes below.
- The most common cause is a **changed IP address** (next point).
- Restart the TV (hold power until it restarts), wait a minute, **Rescan**, try again.
- Try again with the phone close to the router and the TV awake.

### The phone's IP address changed

Your router may give the phone a new address after it reconnects to Wi-Fi or you restart the router. The TV still remembers
the old one, and installs stop working. Fix:

1. Find the phone's current IP (step 3).
2. On the TV: Apps, press **1 2 3 4 5**, put the new IP in **Host PC IP**, **OK**, restart the TV.

To stop it happening again, ask your router to always give the phone the same address (in the router's settings this is
called "DHCP reservation" or "static lease").

### Certificate problems

- **"Sign in with Samsung" fails or says Access Denied:** open the link in another browser on the phone (Chrome, Samsung
  Internet), or allow `account.samsung.com`.
- **The Samsung account has no email address:** add and verify one at account.samsung.com, then try again.
- **The TV rejects the certificate:** the TV needs **internet access** during the install (it checks the certificate
  online) and its **date and time must be right**: TV Settings, General, System Manager, Time. Fix those and install again.
- **"Certificate isn't valid yet" with a countdown:** wait for it to reach zero, the install continues by itself. If the wait
  looks far too long, the phone's clock is wrong: fix its date and time.
- **Still stuck:** in Apps2Samsung open **Settings**, then **Installing**, and switch on **Always create a new certificate**,
  then install again. Switch it off afterwards.

### Alder is installed but I cannot find it

Press **Home**, go to **Apps**, and scroll to the end of the list. If it is not there, install again.

### Alder starts and then shows a black or blank screen

Start it again. If it happens again, follow docs/TV-TEST.md ("When something fails") and send the photos.
