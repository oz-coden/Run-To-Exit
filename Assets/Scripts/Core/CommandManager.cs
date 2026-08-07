using UnityEngine;
using UnityEngine.InputSystem;

namespace RunToExit.Core
{
    public class CommandManager : MonoBehaviour
    {
        public static CommandManager Instance { get; private set; }

        public NPCController SelectedNPC { get; private set; }

        private void Awake()
        {
            if (Instance == null) Instance = this;
            else Destroy(gameObject);
        }

        private void Update()
        {
            if (Mouse.current != null && Mouse.current.leftButton.wasPressedThisFrame)
            {
                HandleClick();
            }
        }

        private void HandleClick()
        {
            Vector2 mousePos = Mouse.current.position.ReadValue();
            Vector3 worldPos = Camera.main.ScreenToWorldPoint(new Vector3(mousePos.x, mousePos.y, -Camera.main.transform.position.z));
            Vector2Int gridPos = new Vector2Int(Mathf.RoundToInt(worldPos.x), Mathf.RoundToInt(worldPos.y));

            // 1. NPCをクリックしたか判定
            Collider2D hit = Physics2D.OverlapPoint(worldPos);
            if (hit != null)
            {
                NPCController npc = hit.GetComponent<NPCController>();
                if (npc != null && npc.IsRescued)
                {
                    SelectNPC(npc);
                    return; // NPCを選択した場合は移動処理はしない
                }
            }

            // 2. マップをクリックした場合、選択中のNPCに移動を指示
            if (SelectedNPC != null)
            {
                SelectedNPC.MoveTo(gridPos);
            }
        }

        public void SelectNPC(NPCController npc)
        {
            if (SelectedNPC != null)
            {
                // 以前の選択解除（色を戻すなど）
                var renderer = SelectedNPC.GetComponent<SpriteRenderer>();
                if (renderer != null) renderer.color = Color.white;
            }

            SelectedNPC = npc;
            Debug.Log($"Selected NPC: {npc.gameObject.name}");

            // 選択中の見た目変更
            var newRenderer = SelectedNPC.GetComponent<SpriteRenderer>();
            if (newRenderer != null) newRenderer.color = Color.yellow;
        }

        // 全体への「ついてこい」「待て」指示などは今後追加
    }
}
