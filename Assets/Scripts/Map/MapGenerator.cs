using System.Collections.Generic;
using UnityEngine;
using RunToExit.Entities.Characters;
using RunToExit.Entities.Gimmicks;
using RunToExit.Entities.Items;

namespace RunToExit.Map
{
    public class MapGenerator : MonoBehaviour
    {
        [Header("Level Data")]
        public RunToExit.App.LevelData currentLevel;

        [Header("Prefabs")]
        public GameObject wallPrefab;
        public GameObject playerPrefab;
        public GameObject boxPrefab;
        public GameObject npcPrefab;
        public GameObject firePrefab;
        public GameObject extinguisherPrefab;
        public GameObject switchPrefab;
        public GameObject doorPrefab;
        public GameObject exitPrefab;
        public GameObject keyPrefab;

        [Header("Settings")]
        public Vector2 startPosition = Vector2.zero; // マップの左下などの基準点

        // スイッチとドアのリンク用一時辞書
        private Dictionary<char, PressureSwitch> pendingSwitches = new Dictionary<char, PressureSwitch>();
        private Dictionary<char, Door> pendingDoors = new Dictionary<char, Door>();

        private void Start()
        {
            if (currentLevel != null)
            {
                GenerateMap(currentLevel.MapLayout);
            }
        }

        public void GenerateMap(string mapLayout)
        {
            if (string.IsNullOrEmpty(mapLayout)) return;

            string[] lines = mapLayout.Split(new[] { '\r', '\n' }, System.StringSplitOptions.RemoveEmptyEntries);
            int height = lines.Length;

            for (int y = 0; y < height; y++)
            {
                string row = lines[y];
                for (int x = 0; x < row.Length; x++)
                {
                    char tile = row[x];
                    int worldY = height - 1 - y;
                    Vector3 position = new Vector3(startPosition.x + x, startPosition.y + worldY, 0);

                    SpawnTile(tile, position);
                }
            }

            LinkGimmicks();
        }

        private void SpawnTile(char tile, Vector3 position)
        {
            GameObject prefabToSpawn = null;
            bool isPlayerOrNpc = false;
            bool isLinkedDoor = false;
            bool isLinkedSwitch = false;
            bool isManualDoor = false;
            bool isLockedDoor = false;

            if (tile == '#') prefabToSpawn = wallPrefab;
            else if (tile == 'P') { prefabToSpawn = playerPrefab; isPlayerOrNpc = true; }
            else if (tile == 'N') { prefabToSpawn = npcPrefab; isPlayerOrNpc = true; }
            else if (tile == 'B') prefabToSpawn = boxPrefab;
            else if (tile == 'F') prefabToSpawn = firePrefab;
            else if (tile == 'E') prefabToSpawn = extinguisherPrefab;
            else if (tile == 'K') prefabToSpawn = keyPrefab;
            else if (tile == 'X') prefabToSpawn = exitPrefab;
            else if (tile == 'D') { prefabToSpawn = doorPrefab; isManualDoor = true; }
            else if (tile == 'L') { prefabToSpawn = doorPrefab; isLockedDoor = true; }
            else if (char.IsLower(tile) && tile >= 'a' && tile <= 'z') 
            { 
                prefabToSpawn = switchPrefab; 
                isLinkedSwitch = true; 
            }
            else if (char.IsUpper(tile) && tile >= 'A' && tile <= 'Z' && tile != 'P' && tile != 'N' && tile != 'B' && tile != 'F' && tile != 'E' && tile != 'K' && tile != 'X' && tile != 'D' && tile != 'L')
            {
                prefabToSpawn = doorPrefab;
                isLinkedDoor = true;
            }

            if (prefabToSpawn != null)
            {
                if (isPlayerOrNpc) position.y += 0.5f;

                GameObject obj = Instantiate(prefabToSpawn, position, Quaternion.identity, this.transform);

                if (isLinkedSwitch)
                {
                    pendingSwitches[tile] = obj.GetComponent<PressureSwitch>();
                }
                else if (isLinkedDoor)
                {
                    char switchKey = char.ToLower(tile);
                    Door door = obj.GetComponent<Door>();
                    door.Type = DoorType.Switch;
                    pendingDoors[switchKey] = door;
                }
                else if (isManualDoor)
                {
                    obj.GetComponent<Door>().Type = DoorType.Manual;
                }
                else if (isLockedDoor)
                {
                    obj.GetComponent<Door>().Type = DoorType.Locked;
                }
            }
        }

        private void LinkGimmicks()
        {
            foreach (var kvp in pendingSwitches)
            {
                char key = kvp.Key;
                PressureSwitch s = kvp.Value;
                if (pendingDoors.TryGetValue(key, out Door d))
                {
                    // スイッチにドアを登録する処理（現状のUnityEventをスクリプトから追加するか、専用の変数を用意する）
                    s.targetDoor = d;
                }
            }
        }
    }
}
