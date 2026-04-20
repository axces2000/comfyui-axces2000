# comfyui-axces2000 — Makefile
# Run `make js` to sync widget JS files from their source folders
# into the top-level js/ directory that ComfyUI serves.
# StringCombine has no JS — pure Python node.
# lame.min.js lives in js/lib/ permanently (not synced by make js).

.PHONY: js clean

js:
	@echo "→ Syncing JS files to js/"
	cp audio_loader/js/audio_loader.js                 js/audio_loader.js
	cp resolution_master/js/resolution_master.js       js/resolution_master.js
	cp string_extractor/js/string_extractor.js         js/string_extractor.js
	cp audio_player/js/audio_player_widget.js          js/audio_player_widget.js
	@echo "✓ Done"

clean:
	@echo "→ Cleaning synced JS files"
	rm -f js/audio_loader.js js/resolution_master.js js/string_extractor.js js/audio_player_widget.js
	@echo "✓ Done"
