using UnityEngine;

namespace RunToExit.Core
{
    public class GridManager : MonoBehaviour
    {
        public static GridManager Instance { get; private set; }

        private void Awake()
        {
            if (Instance == null)
            {
                Instance = this;
            }
            else
            {
                Destroy(gameObject);
            }
        }

        // 整数座標での障害物チェック
        public Collider2D GetObjectAt(Vector2Int gridPos)
        {
            // Physics2Dを用いて、スクリプト制御のためのグリッド確認を行う
            return Physics2D.OverlapPoint(new Vector2(gridPos.x, gridPos.y));
        }

        public bool IsWallAt(Vector2Int gridPos)
        {
            Collider2D col = GetObjectAt(gridPos);
            return col != null && col.CompareTag("Wall");
        }

        public T GetComponentAt<T>(Vector2Int gridPos) where T : Component
        {
            Collider2D col = GetObjectAt(gridPos);
            if (col != null)
            {
                return col.GetComponent<T>();
            }
            return null;
        }
    }
}
