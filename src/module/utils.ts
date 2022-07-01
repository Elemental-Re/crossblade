import {
  CrossbladeEvent,
  CrossbladeEventKey,
  CrossbladePlaylistSound,
  DevModeModuleData,
  Socket,
  SoundLayer,
} from './types';

export const CROSSBLADE_EVENTS: Record<CrossbladeEventKey, CrossbladeEvent> = {
  DEFAULT: {
    key: 'DEFAULT',
    label: 'CROSSBLADE.Events.Default.Label',
    description: 'CROSSBLADE.Events.Default.Description',
  },
  COMBATANT: {
    key: 'COMBATANT',
    label: 'CROSSBLADE.Events.Combatant.Label',
    description: 'CROSSBLADE.Events.Combatant.Description',
    options: {
      FRIENDLY: 'TOKEN.FRIENDLY',
      NEUTRAL: 'TOKEN.NEUTRAL',
      HOSTILE: 'TOKEN.HOSTILE',
    },
  },
  // COMBATANT_TAG: {
  //   key: 'COMBATANT', // Technically the same as the normal Combatant event
  //   label: 'CROSSBLADE.Events.CombatantTag.Label',
  //   description: 'CROSSBLADE.Events.CombatantTag.Description',
  //   isCustom: true,
  // },
  GAME: {
    key: 'GAME',
    label: 'CROSSBLADE.Events.Game.Label',
    description: 'CROSSBLADE.Events.Game.Description',
    options: {
      PAUSED: 'GAME.Paused',
    },
  },
  CUSTOM: {
    key: 'CUSTOM',
    label: 'CROSSBLADE.Events.Custom.Label',
    description: 'CROSSBLADE.Events.Custom.Description',
    isCustom: true,
  },
};

export const MODULE_ID = 'crossblade';
export const MODULE_NAME = 'Crossblade';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function inArray(array: any[] | undefined | null, toCheck: any | undefined | null) {
  return toCheck && array?.includes(toCheck);
}

export function getCrossbladeSound(src: string, basedOn: PlaylistSound) {
  try {
    if (!basedOn.id || !basedOn.data.path) return null;
    const sound = basedOn.sound?.src === src ? basedOn.sound : createCrossbladeSound.bind(basedOn)(src);
    return sound;
  } catch (e) {
    console.error(e);
    return null;
  }
}

function createCrossbladeSound(this: CrossbladePlaylistSound, src: string) {
  const sound = game.audio.create({
    src: src,
    preload: false,
    singleton: false,
  });
  sound.on('start', this._onStart.bind(this));
  return sound;
}

export function getCrossbladeEvent(): string {
  if (game.settings.get(MODULE_ID, 'combatPause') === true && game.paused) return 'GAME: PAUSED';
  if (!game.combat?.started) return game.paused ? 'GAME_PAUSED' : 'DEFAULT';
  switch (game.combat?.combatant?.token?.data.disposition) {
    case CONST.TOKEN_DISPOSITIONS.FRIENDLY:
      return 'COMBATANT: FRIENDLY';
    case CONST.TOKEN_DISPOSITIONS.NEUTRAL:
      return 'COMBATANT: NEUTRAL';
    case CONST.TOKEN_DISPOSITIONS.HOSTILE:
      return 'COMBATANT: HOSTILE';
    default:
      return 'DEFAULT';
  }
}

export function getCrossfadeVolume(pls: CrossbladePlaylistSound, sound: Sound, volume: number = pls.volume) {
  let crossbladeEvent = CrossbladeController.getCurrentEvent();
  const soundLayers = pls.cbSoundLayers ?? new Map<Sound, string[]>();
  // Default volume --- Only activate if this is the base sound;
  let fadeVolume = pls.sound === sound ? volume : 0;
  // If crossblade is enabled and and this PlaylistSound has crossblade sound layers
  if (game.settings.get(MODULE_ID, 'enable') === true && soundLayers.size) {
    // Default event if there's no sounds configured for this event.
    if (crossbladeEvent !== 'DEFAULT' && ![...soundLayers.values()].flat().includes(crossbladeEvent)) {
      crossbladeEvent = 'DEFAULT';
    }
    const currentEventSounds = new Set(
      [...soundLayers.entries()].filter((entry) => entry[1].includes(crossbladeEvent)).map((entry) => entry[0]),
    );
    const otherEventSounds = new Set(
      [...soundLayers.entries()].filter((entry) => !entry[1].includes(crossbladeEvent)).map((entry) => entry[0]),
    );

    // If this event has sounds
    if (currentEventSounds.size) {
      if (currentEventSounds.has(sound)) {
        fadeVolume = volume;
      } else if (otherEventSounds.has(sound) || pls.sound === sound) {
        fadeVolume = 0;
      }
    }
  }
  return fadeVolume;
}

export function getUniqueCrossbladeSounds(pls: CrossbladePlaylistSound, includeBaseSound = false): Set<Sound> {
  const uniqueSounds: Sound[] = [];
  if (includeBaseSound && pls.sound) uniqueSounds.push(pls.sound);
  const soundLayers = pls.cbSoundLayers;
  if (soundLayers) uniqueSounds.push(...soundLayers.keys());
  return new Set(uniqueSounds);
}

export function getLayerOnlyCrossbladeSounds(pls: CrossbladePlaylistSound) {
  const uniqueSounds = getUniqueCrossbladeSounds(pls);
  if (pls.sound) uniqueSounds.delete(pls.sound);
  return uniqueSounds;
}

export async function localFade(pls: CrossbladePlaylistSound, volume: number) {
  const localVolume = volume * game.settings.get('core', 'globalPlaylistVolume');
  if (pls.cbSoundLayers && pls.sound) {
    getUniqueCrossbladeSounds(pls).forEach(async (s) => {
      s.fade(getCrossfadeVolume(pls, s, localVolume), {
        duration: PlaylistSound.VOLUME_DEBOUNCE_MS,
      });
    });
  }
}

export function generateCrossbladeSounds(pls: PlaylistSound) {
  debug('generateCrossbladeSounds');
  const crossbladeSounds = new Map<Sound, string[]>();

  const soundLayers = pls.getFlag('crossblade', 'soundLayers') as SoundLayer[] | undefined;
  debug('soundLayers', soundLayers);
  if (Array.isArray(soundLayers)) {
    soundLayers?.forEach((sl) => {
      if (sl.src && sl.events && sl.events.length > 0) {
        // Use the base sound if it matches the layer, or create a new one.
        const layerSound = getCrossbladeSound(sl.src, pls);
        if (layerSound && !layerSound?.failed) {
          crossbladeSounds.set(
            layerSound,
            sl.events
              .filter((event) => Array.isArray(event) && event.length)
              // Maps ['COMBATANT', 'HOSTILE'] as 'COMBATANT: HOSTILE'
              // Easier to check if an event matches
              .map((event) => event.slice(0, 2).join(': ')),
          );
        }
      }
    });
  }
  return crossbladeSounds;
}

export const getFirstActiveGM = function () {
  const filteredGMs = game.users
    ?.filter((u) => u.isGM && u.active)
    ?.sort((u1, u2) => {
      // Compare ids. EN locale is arbitrary and used for consistency only.
      return u1.id.localeCompare(u2.id, 'en');
    });

  return filteredGMs ? filteredGMs[0] : null;
};

export const isLeadGM = function () {
  return game.user === getFirstActiveGM();
};

export async function clearCrossbladeData(pls: CrossbladePlaylistSound) {
  const flags = pls.data.flags[MODULE_ID] as Record<string, unknown>;
  await Promise.all(Array.from(Object.keys(flags)).map((flag) => pls.unsetFlag(MODULE_ID, flag)));
}

export function log(...args: unknown[]) {
  console.log(`⚔️${MODULE_NAME} |`, ...args);
}

export function debug(...args: unknown[]) {
  try {
    const devMode = game.modules.get('_dev-mode') as DevModeModuleData | undefined;
    if (devMode?.api?.getPackageDebugValue(MODULE_ID)) {
      log(...args);
    }
  } catch (e) {}
}

export function hasOwnProperty<X extends object, Y extends PropertyKey>(
  obj: X,
  prop: Y,
): obj is X & Record<Y, unknown> {
  return obj.hasOwnProperty(prop);
}

/// Sockets
export let socket: Socket | undefined;

Hooks.once('socketlib.ready', () => {
  debug('socketlib.ready');
  socket = socketlib.registerModule(MODULE_ID);
  socket.register('crossfadePlaylists', _crossfadePlaylistsSocket);
  socket.register('crossfadeSounds', _crossfadeSoundsSocket);
  socket.register('getCrossbladeEvent', _getCrossbladeEventSocket);
  socket.register('updateCrossbladeEventSocket', _updateCrossbladeEventSocket);
  socket.register('updatePlaylistSocket', _crossfadePlaylistSocket);
  socket.register('updatePlaylistSoundSocket', _crossfadePlaylistSoundSocket);
});

export async function crossfadePlaylistsSocket(...playlistIds: string[]) {
  debug('crossfadePlaylistsSocket', playlistIds);
  return socket?.executeForEveryone(_crossfadePlaylistsSocket, ...playlistIds);
}

function _crossfadePlaylistsSocket(...playlistIds: string[]) {
  debug('_crossfadePlaylistsSocket', playlistIds);
  const playlists = game.playlists?.filter((p) => playlistIds.includes(p.id));
  if (playlists) {
    CrossbladeController.crossfadePlaylists(...playlists);
  }
}

export async function crossfadeSoundsSocket(playlistId: string, ...soundIds: string[]) {
  debug('crossfadeSoundsSocket', soundIds);
  return socket?.executeForEveryone(_crossfadeSoundsSocket, playlistId, ...soundIds);
}

function _crossfadeSoundsSocket(playlistId: string, ...soundIds: string[]) {
  debug('_crossfadeSoundsSocket', soundIds);
  const playlist = game.playlists?.find((p) => p.id === playlistId);
  const sounds = playlist?.sounds.filter((s) => (s.id && soundIds.includes(s.id)) as boolean);
  if (sounds) {
    CrossbladeController.crossfadeSounds(...sounds);
  }
}

export async function getCrossbladeEventSocket() {
  debug('getCrossbladeEventSocket');
  return socket?.executeAsGM(_getCrossbladeEventSocket);
}

function _getCrossbladeEventSocket() {
  debug('_getCrossbladeEventSocket');
  return getCrossbladeEvent();
}

export async function updateCrossbladeEventSocket(status: string) {
  debug('updateCrossbladeEventSocket', status);
  return socket?.executeForEveryone(_updateCrossbladeEventSocket, status);
}

function _updateCrossbladeEventSocket(status: string) {
  debug('_updateCrossbladeEventSocket', status);
  CrossbladeController.setCurrentEvent(status);
  CrossbladeController.crossfadePlaylists();
}

export async function crossfadePlaylistSocket(status: string, ...playlists: Playlist[]) {
  debug('crossfadePlaylistSocket', status, playlists);
  return socket?.executeForEveryone(
    _crossfadePlaylistSocket,
    status,
    playlists.map((p) => p.id),
  );
}

function _crossfadePlaylistSocket(status: string, ...playlistIds: string[]) {
  debug('_crossfadePlaylistSocket', status, playlistIds);
  CrossbladeController.setCurrentEvent(status);
  const playlists = game.playlists?.filter((p) => playlistIds.includes(p.id)) ?? [];
  CrossbladeController.crossfadePlaylists(...playlists);
}

export async function crossfadePlaylistSoundSocket(status: string, ...sounds: PlaylistSound[]) {
  debug('crossfadePlaylistSoundSocket', status, sounds);
  return socket?.executeForEveryone(_crossfadePlaylistSoundSocket, status, ...sounds.map((s) => s.uuid));
}

function _crossfadePlaylistSoundSocket(status: string, ...soundUuids: string[]) {
  debug('_crossfadePlaylistSoundSocket', status, soundUuids);
  CrossbladeController.setCurrentEvent(status);

  Promise.all(
    soundUuids.map((uuid) => {
      return fromUuid(uuid) as Promise<PlaylistSound>;
    }),
  ).then((sounds) => {
    CrossbladeController.crossfadeSounds(...sounds);
  });
}

export class CrossbladeController {
  protected static _currentStatus = 'DEFAULT';

  static getCurrentEvent(): string {
    return this._currentStatus;
  }

  static setCurrentEvent(status: string) {
    this._currentStatus = status;
  }

  static getCrossbladePlaylists(...playlists: Playlist[]) {
    // Filter down to only crossfade-applicable playlists...
    return playlists?.filter((p) =>
      p.sounds.find((s) => {
        const cbps = s as CrossbladePlaylistSound;
        const soundLayers = cbps.cbSoundLayers;
        if (soundLayers && soundLayers.size > 0) return true;
        else return false;
      }),
    );
  }
  static async crossfadePlaylists(...playlists: Playlist[]) {
    playlists = playlists.length ? playlists : game.playlists?.playing || [];
    debug('crossfading Playlists...', playlists);
    const crossbladeSounds: PlaylistSound[] = [];
    playlists.forEach((p) =>
      crossbladeSounds.push(
        ...p.sounds.filter((pls: CrossbladePlaylistSound) => {
          const cbpsSize = pls.cbSoundLayers?.size;
          const isCrossbladeSound = typeof cbpsSize === 'number' && cbpsSize > 0;
          return pls.playing && isCrossbladeSound;
        }),
      ),
    );
    this.crossfadeSounds(...crossbladeSounds);
    debug('...done crossfading Playlists', playlists);
  }
  static async crossfadeSounds(...playlistSounds: CrossbladePlaylistSound[]) {
    playlistSounds = playlistSounds.filter((pls) => pls.playing || pls.parent?.playing);
    debug('crossfading sounds...', playlistSounds);
    playlistSounds.forEach(async (pls) => {
      const cbps = pls as CrossbladePlaylistSound;
      if (cbps.cbSoundLayers && cbps.sound) {
        log('Handling crossfade for', `🎵${pls.name}🎵`);
        cbps.sync();
      }
    });
    debug('...done crossfading sounds', playlistSounds);
  }
}
