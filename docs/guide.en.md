# Using PulseDeck

[Home](../README.en.md) · [Русский](guide.ru.md)

## Start monitoring

[Download the installer](https://github.com/dmitriiavdeev/pulsedeck-network/releases/download/v1.1.1/PulseDeck-Setup-1.1.1-x64.exe), install PulseDeck and open the app. Windows 10 and 11, 64-bit, are supported.

Click Add monitor. For server recovery, keep SSH selected and use port 22, or enter your custom SSH port. For other tasks, choose a check type and enter an IP address, domain or website URL. For a port check, enter the port number too. Save the monitor and click Start monitoring. Use Import to add a larger list.

Ping checks whether a device responds to a network request. TCP checks a specific port, while HTTP / HTTPS checks a website's response. For websites, choose HTTP / HTTPS: a Ping reply alone does not mean the website is working.

SSH verifies the service greeting without a username or password. It does not test login to a particular account. To change an existing Ping or TCP monitor, click Edit, choose SSH and confirm the port. History starts afresh for the new check type.

A VPN may reply to Ping or accept a TCP connection before the remote server responds. Those results do not confirm that SSH or a website is working.

## Updating the app

Open Settings / Updates and click Check for updates. PulseDeck shows the new version and download size. Click Download changes, then Restart and update. Only changed parts of files are downloaded; your monitors, history and settings are preserved.

To upgrade from version 1.0 or 1.1.0, first install version 1.1.1 or later using the installer. Subsequent updates are available inside the app.

## Notifications

Open Settings and enable desktop notifications, sounds or Telegram messages. Each channel can be switched on or off independently. Sound alerts include 20 melodies, a preview and volume control.

For Telegram, create a dedicated bot with [BotFather](https://t.me/BotFather). Open a chat with your new bot and press Start. In PulseDeck settings, paste the bot token, click Find chat, select the chat, send a test message and save.

By default, a status change requires two consecutive matching checks. This helps avoid an unnecessary alert when a single response is lost.

## Background monitoring

Closing the window keeps PulseDeck running in the system tray beside the Windows clock. Desktop notifications and sounds continue to work there when enabled in settings.

To exit completely, right-click the tray icon and select Quit. Your computer must remain on and awake for monitoring to continue.

Startup with Windows is disabled by default. Enable it in Settings / General to launch PulseDeck when you sign in to Windows.

## Getting help

[Report an issue](https://github.com/dmitriiavdeev/pulsedeck-network/issues) with a description of the problem and your Windows and PulseDeck versions. Do not include your Telegram token or other private information.
