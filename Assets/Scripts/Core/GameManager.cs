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
            if (player == null || !exitCol.OverlapPoint(player.transform.position)) return;

            var npcs = FindObjectsOfType<NPCController>();
            foreach (var npc in npcs)
            {
                if (!exitCol.OverlapPoint(npc.transform.position))
                {
                    Debug.Log($"Waiting for {npc.gameObject.name} to reach the exit.");
                    return;
                }
            }

            isCleared = true;
            Debug.Log("STAGE CLEAR! All characters reached the exit.");
            // UI表示や次ステージへの遷移処理をここに追加
        }
    }
}
