using UnityEngine;

namespace RunToExit.Core
{
    public class MapGenerator : MonoBehaviour
    {
        [Header("Level Data")]
        public LevelData currentLevel;

        [Header("Prefabs")]
        public GameObject wallPrefab;
        public GameObject playerPrefab;
        public GameObject boxPrefab;
        // 今後NPCやドアなどのPrefabを追加していきます

        [Header("Settings")]
        public Vector2 startPosition = Vector2.zero; // マップの左下などの基準点

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

            // テキストを行ごとに分割（改行コードを考慮）
            string[] lines = mapLayout.Split(new[] { '\r', '\n' }, System.StringSplitOptions.RemoveEmptyEntries);

            // Unityの座標系（下から上へYが増加）に合わせるため、行を下から処理するか、Yを反転する
            // ここではテキストの1行目がマップの一番上（Yが最大）だと仮定して処理します。
            int height = lines.Length;

            for (int y = 0; y < height; y++)
            {
                string row = lines[y];
                for (int x = 0; x < row.Length; x++)
                {
                    char tile = row[x];
                    
                    // Unity上のY座標は、下に行くほどマイナスにならないように逆算する
                    int worldY = height - 1 - y;
                    Vector3 position = new Vector3(startPosition.x + x, startPosition.y + worldY, 0);

                    SpawnTile(tile, position);
                }
            }
        }

        private void SpawnTile(char tile, Vector3 position)
        {
            GameObject prefabToSpawn = null;

            switch (tile)
            {
                case '#': // 壁・床
                    prefabToSpawn = wallPrefab;
                    break;
                case 'P': // プレイヤー
                    prefabToSpawn = playerPrefab;
                    position.y += 0.5f; // プレイヤーは2マスサイズで中心座標がズレるため+0.5調整
                    break;
                case 'B': // 木箱
                    prefabToSpawn = boxPrefab;
                    break;
                case ' ': // 空白
                default:
                    return;
            }

            if (prefabToSpawn != null)
            {
                Instantiate(prefabToSpawn, position, Quaternion.identity, this.transform);
            }
            else
            {
                Debug.LogWarning($"Prefab for tile '{tile}' is not assigned in MapGenerator.");
            }
        }
    }
}
