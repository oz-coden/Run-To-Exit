using UnityEngine;

namespace RunToExit.Core
{
    public class GameManager : MonoBehaviour
    {
        public static GameManager Instance { get; private set; }

        private bool isCleared = false;

        private void Awake()
        {
            if (Instance == null) Instance = this;
            else Destroy(gameObject);
        }

        public void CheckClearCondition()
        {
            if (isCleared) return;

            var exitDoor = FindObjectOfType<ExitDoor>();
            if (exitDoor == null) return;
            
            var exitCol = exitDoor.GetComponent<Collider2D>();
            if (exitCol == null) return;

            var player = FindObjectOfType<PlayerController>();

            // プレイヤーが非常口に到達していない場合はクリア不可
            if (player == null || !exitCol.OverlapPoint(player.transform.position))
            {
                return;
            }

            // マップ上の全NPCを確認（未脱出かつ未救出のNPCがいるか、未脱出のNPCが非常口にいない場合）
            var npcs = FindObjectsOfType<NPCController>();
            foreach (var npc in npcs)
            {
                if (!npc.IsEscaped)
                {
                    // まだ脱出していないNPCがいる場合はクリア保留
                    Debug.Log($"Waiting for {npc.gameObject.name} to escape.");
                    return;
                }
            }

            isCleared = true;
            Debug.Log("STAGE CLEAR! All characters reached the exit!");
            // UI表示や次ステージへの遷移処理をここに追加
        }
    }
}
